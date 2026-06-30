import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import { Sparkles, Loader2, RefreshCw, AlertTriangle } from 'lucide-react';
import { useMachinePlan } from '@/lib/useMachinePlan';

/**
 * Livy's read of the production plan — the "vehicle" on top of the engine.
 *
 * The deterministic engine has ALREADY computed the plan (quantities + machine
 * load). We hand that finished plan to Livy as grounding and ask only for
 * JUDGMENT: the top priority, machine balance, risks, one adjustment. Because
 * the numbers are in the prompt, Livy never calls tools or writes code — so it's
 * fast (~5-10s) and deterministic, avoiding the latency/non-determinism that
 * comes from letting an LLM do the maths.
 *
 * @param {Array} lines - flattened plan lines with soh_at_plan / committed_at_plan
 *                        / par_at_plan / planned_qty / product_name / product_sku
 */
export default function LivyPlanRead({ lines = [] }) {
  const { plan: machinePlan, isLoading: planLoading } = useMachinePlan(lines);
  const [reply, setReply] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const ranFor = useRef(null);

  // Compact, grounded summary of the engine's plan for Livy to reason over.
  const summary = useMemo(() => {
    const backorders = [];
    const belowPar = [];
    let totalUnits = 0;
    for (const l of lines) {
      const soh = l.soh_at_plan || 0;
      const com = l.committed_at_plan || 0;
      const par = l.par_at_plan || 0;
      const qty = l.planned_qty || 0;
      totalUnits += qty;
      if (com > soh) backorders.push({ sku: l.product_sku, name: l.product_name, owed: com - soh, making: qty });
      else if (par > 0 && (soh - com) < par) belowPar.push({ sku: l.product_sku, name: l.product_name, short: par - (soh - com), making: qty });
    }
    backorders.sort((a, b) => b.owed - a.owed);
    belowPar.sort((a, b) => b.short - a.short);
    const topMakes = [...lines].sort((a, b) => (b.planned_qty || 0) - (a.planned_qty || 0))
      .slice(0, 6).map(l => ({ sku: l.product_sku, name: l.product_name, qty: l.planned_qty }));
    const machines = (machinePlan?.groups || []).map(g => ({
      machine: g.label, utilisation_pct: g.utilisationPct, over_capacity: g.over,
      kg: Math.round(g.kg), batches: g.batches,
    }));
    return {
      date: new Date().toISOString().slice(0, 10),
      total_meals: totalUnits,
      meal_lines: lines.length,
      backorders: backorders.slice(0, 8),
      below_par: belowPar.slice(0, 8),
      top_quantities: topMakes,
      machines,
      bulks_without_capacity: (machinePlan?.unscheduled || []).map(u => u.name),
    };
  }, [lines, machinePlan]);

  const ask = useCallback(async () => {
    if (!lines.length) return;
    setLoading(true); setError(''); setReply('');
    const system = {
      role: 'system',
      content:
        "You are Livy, the Lean Living production planner. The deterministic engine has ALREADY computed today's plan — the JSON below is FINAL and correct. Do NOT recompute, call tools, or write code; reason only over these numbers. " +
        "Give the production manager a tight read in markdown:\n" +
        "• **Top priority** — the single most important thing to make first and why (backorders/owed orders rank above below-par).\n" +
        "• **Machine balance** — call out anything overloaded (>100%) or sitting idle; suggest a shift if it helps (wet line: Ivario ↔ tilting pan is interchangeable).\n" +
        "• **Watch** — any risk (over-capacity defers to tomorrow, a bulk with no capacity set, a big single-meal load).\n" +
        "• **One adjustment** — optional, concrete, only if it clearly improves the day.\n" +
        "Be concise — short bullets, ground every point in the numbers. ZAR, meals in units, Africa/Johannesburg.",
    };
    const user = { role: 'user', content: 'Today\'s computed plan:\n```json\n' + JSON.stringify(summary, null, 0) + '\n```' };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 58000);
    try {
      let resp;
      try {
        resp = await fetch('/__fn/livy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: 'gpt-5.4', stream: false, messages: [system, user] }),
          signal: controller.signal,
        });
      } finally { clearTimeout(timer); }
      const raw = await resp.text();
      let data = null;
      try { data = raw ? JSON.parse(raw) : null; } catch { /* non-JSON */ }
      if (!resp.ok || !data) {
        throw new Error(data?.error?.message || data?.error || (raw ? raw.slice(0, 140) : `HTTP ${resp.status}`));
      }
      setReply(data?.choices?.[0]?.message?.content || 'No response.');
    } catch (err) {
      setError(err.name === 'AbortError'
        ? "Livy took too long to read the plan — try Refresh in a moment."
        : `Couldn't get Livy's read: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, [lines.length, summary]);

  // Auto-run once when the plan is ready (so it "just happens"), re-runnable.
  useEffect(() => {
    if (planLoading || !lines.length) return;
    const key = `${lines.length}:${summary.total_meals}`;
    if (ranFor.current === key) return;
    ranFor.current = key;
    ask();
  }, [planLoading, lines.length, summary.total_meals, ask]);

  if (!lines.length) return null;

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="px-6 py-4 border-b border-border flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
          <Sparkles className="w-4 h-4 text-primary" />
        </div>
        <div className="flex-1">
          <h3 className="font-bold text-base">Livy's read</h3>
          <p className="text-xs text-muted-foreground">Reasoning over the engine's computed plan — priorities, balance, risks.</p>
        </div>
        <button
          onClick={ask}
          disabled={loading || planLoading}
          className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-border hover:bg-muted disabled:opacity-50 transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      <div className="px-6 py-4">
        {(loading || planLoading) && !reply && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Livy is reading the plan…
          </div>
        )}
        {error && (
          <div className="flex items-start gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> {error}
          </div>
        )}
        {reply && (
          <div className="prose prose-sm dark:prose-invert max-w-none [&_p]:my-1 [&_ul]:my-1 [&_li]:my-0.5">
            <ReactMarkdown>{reply}</ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}
