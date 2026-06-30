import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import { Sparkles, Loader2, RefreshCw, AlertTriangle, Check, ArrowRight } from 'lucide-react';
import { useMachinePlan } from '@/lib/useMachinePlan';

/**
 * Livy's read of the production plan — the "vehicle" on top of the engine.
 *
 * The deterministic engine has ALREADY computed the plan (quantities + machine
 * load). We hand that finished plan to Livy as grounding and ask for JUDGMENT:
 * a prose read PLUS structured quantity adjustments. Because the numbers are in
 * the prompt, Livy never calls tools or writes code — fast (~5-10s) and
 * deterministic.
 *
 * Phase 2: the adjustments come back as one-tap chips. Accepting one sets that
 * meal's quantity (onApply), which flows straight back into the engine — the
 * machine load and totals recompute live.
 *
 * @param {Array}    lines   - flattened plan lines (soh/committed/par/planned_qty/name/sku)
 * @param {function} onApply - (sku, toQty) => void; applies a suggested quantity
 */
function extractAdjustments(text) {
  const m = text.match(/```json\s*([\s\S]*?)```/i);
  if (!m) return { clean: text, adjustments: [] };
  let parsed = null;
  try { parsed = JSON.parse(m[1].trim()); } catch { /* ignore bad json */ }
  const clean = text.replace(m[0], '').trim();
  const arr = Array.isArray(parsed) ? parsed
    : (parsed && Array.isArray(parsed.adjustments)) ? parsed.adjustments : [];
  return { clean, adjustments: arr };
}

export default function LivyPlanRead({ lines = [], onApply }) {
  const { plan: machinePlan, isLoading: planLoading } = useMachinePlan(lines);
  const [reply, setReply] = useState('');
  const [adjustments, setAdjustments] = useState([]);
  const [applied, setApplied] = useState(() => new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const hasRun = useRef(false);

  const currentQtyBySku = useMemo(() => {
    const m = {};
    lines.forEach(l => { if (l.product_sku) m[l.product_sku] = (m[l.product_sku] || 0) + (l.planned_qty || 0); });
    return m;
  }, [lines]);

  const summary = useMemo(() => {
    const backorders = [];
    const belowPar = [];
    let totalUnits = 0;
    for (const l of lines) {
      const soh = l.soh_at_plan || 0, com = l.committed_at_plan || 0, par = l.par_at_plan || 0, qty = l.planned_qty || 0;
      totalUnits += qty;
      if (com > soh) backorders.push({ sku: l.product_sku, name: l.product_name, owed: com - soh, making: qty });
      else if (par > 0 && (soh - com) < par) belowPar.push({ sku: l.product_sku, name: l.product_name, short: par - (soh - com), making: qty });
    }
    backorders.sort((a, b) => b.owed - a.owed);
    belowPar.sort((a, b) => b.short - a.short);
    const topMakes = [...lines].sort((a, b) => (b.planned_qty || 0) - (a.planned_qty || 0))
      .slice(0, 6).map(l => ({ sku: l.product_sku, name: l.product_name, qty: l.planned_qty }));
    const machines = (machinePlan?.groups || []).map(g => ({
      machine: g.label, utilisation_pct: g.utilisationPct, over_capacity: g.over, kg: Math.round(g.kg), batches: g.batches,
    }));
    return {
      date: new Date().toISOString().slice(0, 10),
      total_meals: totalUnits, meal_lines: lines.length,
      backorders: backorders.slice(0, 8), below_par: belowPar.slice(0, 8),
      top_quantities: topMakes, machines,
      bulks_without_capacity: (machinePlan?.unscheduled || []).map(u => u.name),
    };
  }, [lines, machinePlan]);

  const ask = useCallback(async () => {
    if (!lines.length) return;
    setLoading(true); setError(''); setReply(''); setAdjustments([]); setApplied(new Set());
    const system = {
      role: 'system',
      content:
        "You are Livy, the Lean Living production planner. The deterministic engine has ALREADY computed today's plan — the JSON below is FINAL and correct. Do NOT recompute, call tools, or write code; reason only over these numbers.\n" +
        "Give the production manager a tight read in markdown:\n" +
        "• **Top priority** — the single most important thing to make first and why (backorders/owed orders rank above below-par).\n" +
        "• **Machine balance** — call out anything overloaded (>100%) or idle; the wet line is interchangeable (Ivario ≤20kg ↔ tilting pan ≤100kg).\n" +
        "• **Watch** — any risk (over-capacity defers to tomorrow, a bulk with no capacity, a big single-meal load).\n" +
        "Be concise — short bullets, ground every point in the numbers. ZAR, meals in units, Africa/Johannesburg.\n\n" +
        "THEN, only if you'd actually change a make-quantity, append a fenced json block (and nothing after it):\n" +
        "```json\n{\"adjustments\":[{\"sku\":\"MWL10\",\"name\":\"Lean Mince…\",\"to_qty\":120,\"reason\":\"clear backorder + top seller\"}]}\n```\n" +
        "to_qty is the NEW TOTAL units for that meal. Include only meals you'd change (max 5). If nothing should change, omit the block entirely.",
    };
    const user = { role: 'user', content: "Today's computed plan:\n```json\n" + JSON.stringify(summary) + "\n```" };
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
      if (!resp.ok || !data) throw new Error(data?.error?.message || data?.error || (raw ? raw.slice(0, 140) : `HTTP ${resp.status}`));
      const { clean, adjustments: adj } = extractAdjustments(data?.choices?.[0]?.message?.content || 'No response.');
      setReply(clean);
      // Keep only real, applyable changes (known sku, numeric, different from current).
      setAdjustments(adj.filter(a => a && a.sku && Number.isFinite(Number(a.to_qty))
        && Number(a.to_qty) !== (currentQtyBySku[a.sku] ?? null)).slice(0, 5));
    } catch (err) {
      setError(err.name === 'AbortError'
        ? "Livy took too long to read the plan — try Refresh in a moment."
        : `Couldn't get Livy's read: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, [lines.length, summary, currentQtyBySku]);

  // Auto-run ONCE when the plan is first ready (so it "just happens"). Applying an
  // adjustment must NOT silently re-trigger Livy — use Refresh for an updated read.
  useEffect(() => {
    if (planLoading || !lines.length || hasRun.current) return;
    hasRun.current = true;
    ask();
  }, [planLoading, lines.length, ask]);

  const applyOne = (a) => {
    onApply?.(a.sku, Number(a.to_qty));
    setApplied(prev => new Set(prev).add(a.sku));
  };

  if (!lines.length) return null;

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="px-6 py-4 border-b border-border flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
          <Sparkles className="w-4 h-4 text-primary" />
        </div>
        <div className="flex-1">
          <h3 className="font-bold text-base">Livy's read</h3>
          <p className="text-xs text-muted-foreground">Reasoning over the engine's computed plan — priorities, balance, suggested tweaks.</p>
        </div>
        <button onClick={ask} disabled={loading || planLoading}
          className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-border hover:bg-muted disabled:opacity-50 transition-colors">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      <div className="px-6 py-4 space-y-4">
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

        {/* Suggested adjustments — one-tap, feed straight back into the engine */}
        {adjustments.length > 0 && (
          <div className="border-t border-border pt-3">
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">Suggested adjustments</p>
            <div className="space-y-2">
              {adjustments.map((a) => {
                const cur = currentQtyBySku[a.sku] ?? 0;
                const done = applied.has(a.sku);
                return (
                  <div key={a.sku} className="flex items-center gap-3 bg-muted/40 border border-border rounded-lg px-3 py-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 text-sm">
                        <span className="font-medium truncate">{a.name || a.sku}</span>
                        <span className="text-xs tabular-nums text-muted-foreground inline-flex items-center gap-1 shrink-0">
                          {cur} <ArrowRight className="w-3 h-3" /> <span className="font-semibold text-foreground">{a.to_qty}</span>
                        </span>
                      </div>
                      {a.reason && <p className="text-[11px] text-muted-foreground truncate">{a.reason}</p>}
                    </div>
                    <button
                      onClick={() => applyOne(a)}
                      disabled={done}
                      className={`inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg shrink-0 transition-colors ${
                        done ? 'bg-emerald-100 text-emerald-700 cursor-default'
                             : 'bg-primary text-primary-foreground hover:bg-primary/90'}`}
                    >
                      <Check className="w-3.5 h-3.5" /> {done ? 'Applied' : 'Apply'}
                    </button>
                  </div>
                );
              })}
            </div>
            <p className="text-[10px] text-muted-foreground mt-2">Applying updates the run quantities below and re-balances the machines. Hit Refresh for Livy's updated read.</p>
          </div>
        )}
      </div>
    </div>
  );
}
