import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import { Sparkles, Loader2, RefreshCw, AlertTriangle, Check, ArrowRight, Flag, Gauge, Eye, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useMachinePlan } from '@/lib/useMachinePlan';

/**
 * Livy's read of the production plan — the "vehicle" on top of the engine.
 *
 * The engine computes the plan (quantities + machine load); Livy reasons over it
 * for JUDGMENT. To make the output easy to scan, Livy returns a STRUCTURED object
 * (headline / make-first / machine / watch / adjustments) which we render as
 * designed sections. If the structure ever fails to parse we fall back to plain
 * markdown so it never breaks. Grounded on the engine's numbers → fast (~5-15s),
 * deterministic, no tool round-trips for the maths.
 *
 * @param {Array}    lines        - flattened plan lines (soh/committed/par/qty/name/sku)
 * @param {function} onApply      - (sku, toQty) => void; applies a suggested quantity
 * @param {function} onSuggestions- (adjustments) => void; for the learning loop
 */
function extractStructured(text) {
  if (!text) return null;
  let body = text;
  const fence = text.match(/```json\s*([\s\S]*?)```/i) || text.match(/```\s*([\s\S]*?)```/i);
  if (fence) body = fence[1];
  const first = body.indexOf('{');
  const last = body.lastIndexOf('}');
  if (first === -1 || last <= first) return null;
  try { return JSON.parse(body.slice(first, last + 1)); } catch { return null; }
}

const FLOW_START_MIN = 7 * 60 + 30; // 07:30 cook-window start
const flowClock = (min) => {
  const h = Math.floor((FLOW_START_MIN + min) / 60) % 24, m = Math.round((FLOW_START_MIN + min) % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

export default function LivyPlanRead({ lines = [], onApply, onSuggestions }) {
  const { plan: machinePlan, flow, isLoading: planLoading } = useMachinePlan(lines);
  const [structured, setStructured] = useState(null);
  const [fallbackText, setFallbackText] = useState('');
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
    const backorders = [], belowPar = [], catchUp = [];
    let totalUnits = 0;
    for (const l of lines) {
      const soh = l.soh_at_plan || 0, com = l.committed_at_plan || 0, par = l.par_at_plan || 0, qty = l.planned_qty || 0;
      totalUnits += qty;
      if (l.reason === 'catch_up') catchUp.push({ sku: l.product_sku, name: l.product_name, making: qty });
      else if (com > soh) backorders.push({ sku: l.product_sku, name: l.product_name, owed: com - soh, making: qty });
      else if (par > 0 && (soh - com) < par) belowPar.push({ sku: l.product_sku, name: l.product_name, short: par - (soh - com), making: qty });
    }
    backorders.sort((a, b) => b.owed - a.owed);
    belowPar.sort((a, b) => b.short - a.short);
    const topMakes = [...lines].sort((a, b) => (b.planned_qty || 0) - (a.planned_qty || 0))
      .slice(0, 6).map(l => ({ sku: l.product_sku, name: l.product_name, qty: l.planned_qty }));
    const machines = (machinePlan?.groups || []).map(g => ({
      machine: g.label, utilisation_pct: g.utilisationPct, over_capacity: g.over, kg: Math.round(g.kg), batches: g.batches,
    }));
    const cookOrder = (flow?.steps || []).slice(0, 6).map(s => ({ bulk: s.name, machine: s.machine, feeds_meals: s.fanOut }));
    return {
      date: new Date().toISOString().slice(0, 10), total_meals: totalUnits, meal_lines: lines.length,
      backorders: backorders.slice(0, 8), below_par: belowPar.slice(0, 8),
      catch_up: catchUp.slice(0, 12),
      top_quantities: topMakes, machines, bulks_without_capacity: (machinePlan?.unscheduled || []).map(u => u.name),
      cook_order: cookOrder,
      portioning_can_start: flow ? flowClock(flow.portioningStartMin) : null,
      all_cooked_by: flow ? flowClock(flow.doneMin) : null,
    };
  }, [lines, machinePlan, flow]);

  const ask = useCallback(async () => {
    if (!lines.length) return;
    setLoading(true); setError(''); setStructured(null); setFallbackText(''); setAdjustments([]); setApplied(new Set());
    const system = {
      role: 'system',
      content:
        "You are Livy, the Lean Living production planner. The deterministic engine has ALREADY computed today's plan — the JSON below is FINAL and correct.\n" +
        "First, do ONE quick lookup of your own memory (brain_search) for saved notes on how this manager prefers production planned, and factor them in. Use NO other tools (no ERP tools) and do NOT write or run code — the plan numbers are final; never recompute them.\n" +
        "Reply with ONLY a JSON object (no text before or after it) in EXACTLY this shape:\n" +
        '{"headline":"one short sentence — the bottom line",' +
        '"make_first":[{"name":"Lean Mince…","sku":"MWL10","qty":89,"why":"14 owed + biggest run"}],' +
        '"machine":["≤8-word note on balance/idle/overload"],' +
        '"watch":[{"level":"risk","text":"short risk or note"}],' +
        '"adjustments":[{"sku":"MWL10","name":"Lean Mince…","to_qty":120,"reason":"short why"}]}\n' +
        "Rules: make_first = ordered make-first list (backorders before below-par), qty = today's make for that meal, keep ≤5. machine = 1-3 very short notes (the wet line Ivario↔tilting pan is interchangeable). watch = risks (level:\"risk\") or notes (level:\"info\"), ≤4, each one line. adjustments = ONLY real make-quantity changes you'd recommend (to_qty = new total), max 5, else []. Every string short and scannable. Numbers from the plan only.\n" +
        "NOTE: a `catch_up` list means the engine already topped up the other package variants of a dish whose bulk is being cooked anyway (same recipe, different plating) — call this out positively in `watch` (level:\"info\") if present, e.g. \"Caught up 3 packages on shared bulks\".\n" +
        "NOTE: `cook_order` is the recommended sequence (broad+slow bulks first) and `portioning_can_start` is when the line can begin. Work the flow into your read — e.g. a make_first 'why' like \"start first, feeds 12 meals\", or a watch note \"portioning can start ~08:40\".",
    };
    const user = { role: 'user', content: "Today's computed plan:\n```json\n" + JSON.stringify(summary) + "\n```" };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 58000);
    try {
      let resp;
      try {
        resp = await fetch('/__fn/livy', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: 'gpt-5.4', stream: false, messages: [system, user] }),
          signal: controller.signal,
        });
      } finally { clearTimeout(timer); }
      const raw = await resp.text();
      let data = null;
      try { data = raw ? JSON.parse(raw) : null; } catch { /* non-JSON */ }
      if (!resp.ok || !data) throw new Error(data?.error?.message || data?.error || (raw ? raw.slice(0, 140) : `HTTP ${resp.status}`));
      const content = data?.choices?.[0]?.message?.content || '';
      const obj = extractStructured(content);
      if (obj && (obj.make_first || obj.headline || obj.watch)) {
        setStructured(obj);
        const adj = Array.isArray(obj.adjustments) ? obj.adjustments : [];
        const usable = adj.filter(a => a && a.sku && Number.isFinite(Number(a.to_qty))
          && Number(a.to_qty) !== (currentQtyBySku[a.sku] ?? null)).slice(0, 5);
        setAdjustments(usable);
        onSuggestions?.(usable);
      } else {
        setFallbackText(content || 'No response.');
        onSuggestions?.([]);
      }
    } catch (err) {
      setError(err.name === 'AbortError'
        ? "Livy took too long to read the plan — try Refresh in a moment."
        : `Couldn't get Livy's read: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, [lines.length, summary, currentQtyBySku, onSuggestions]);

  useEffect(() => {
    if (planLoading || !lines.length || hasRun.current) return;
    hasRun.current = true;
    ask();
  }, [planLoading, lines.length, ask]);

  const applyOne = (a) => { onApply?.(a.sku, Number(a.to_qty)); setApplied(prev => new Set(prev).add(a.sku)); };

  if (!lines.length) return null;

  const s = structured;
  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      {/* Header */}
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

      <div className="px-6 py-5 space-y-5">
        {(loading || planLoading) && !s && !fallbackText && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Livy is reading the plan…
          </div>
        )}
        {error && (
          <div className="flex items-start gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> {error}
          </div>
        )}

        {/* Structured read */}
        {s && (
          <>
            {s.headline && (
              <div className="flex items-start gap-2.5 bg-primary/5 border border-primary/15 rounded-lg px-4 py-3">
                <Sparkles className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                <p className="text-sm font-medium text-foreground leading-snug">{s.headline}</p>
              </div>
            )}

            {Array.isArray(s.make_first) && s.make_first.length > 0 && (
              <Section icon={Flag} title="Make first" tint="text-emerald-600">
                <ol className="space-y-1.5">
                  {s.make_first.map((m, i) => (
                    <li key={m.sku || i} className="flex items-start gap-3">
                      <span className="w-5 h-5 rounded-full bg-emerald-100 text-emerald-700 text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-2 flex-wrap">
                          <span className="text-sm font-semibold text-foreground">{m.name || m.sku}</span>
                          {m.sku && <span className="text-[10px] font-mono text-muted-foreground">{m.sku}</span>}
                          {Number.isFinite(Number(m.qty)) && (
                            <span className="text-[11px] tabular-nums font-semibold bg-muted px-1.5 py-0.5 rounded">{m.qty} units</span>
                          )}
                        </div>
                        {m.why && <p className="text-xs text-muted-foreground leading-snug">{m.why}</p>}
                      </div>
                    </li>
                  ))}
                </ol>
              </Section>
            )}

            {Array.isArray(s.machine) && s.machine.length > 0 && (
              <Section icon={Gauge} title="Machine balance" tint="text-sky-600">
                <ul className="space-y-1">
                  {s.machine.map((t, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-foreground">
                      <span className="w-1 h-1 rounded-full bg-muted-foreground/50 mt-2 shrink-0" />
                      <span className="leading-snug">{typeof t === 'string' ? t : t?.text}</span>
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            {Array.isArray(s.watch) && s.watch.length > 0 && (
              <Section icon={Eye} title="Watch" tint="text-amber-600">
                <ul className="space-y-1.5">
                  {s.watch.map((w, i) => {
                    const risk = (w?.level || 'info') === 'risk';
                    const Icon = risk ? AlertTriangle : Info;
                    return (
                      <li key={i} className="flex items-start gap-2 text-sm">
                        <Icon className={cn('w-3.5 h-3.5 mt-0.5 shrink-0', risk ? 'text-amber-500' : 'text-muted-foreground')} />
                        <span className={cn('leading-snug', risk ? 'text-foreground' : 'text-muted-foreground')}>{w?.text || (typeof w === 'string' ? w : '')}</span>
                      </li>
                    );
                  })}
                </ul>
              </Section>
            )}
          </>
        )}

        {/* Fallback: plain markdown if the structure didn't parse */}
        {!s && fallbackText && (
          <div className="prose prose-sm dark:prose-invert max-w-none [&_p]:my-1 [&_ul]:my-1 [&_li]:my-0.5">
            <ReactMarkdown>{fallbackText}</ReactMarkdown>
          </div>
        )}

        {/* Suggested adjustments — one-tap, feed straight back into the engine */}
        {adjustments.length > 0 && (
          <div className="border-t border-border pt-4">
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
                    <button onClick={() => applyOne(a)} disabled={done}
                      className={cn('inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg shrink-0 transition-colors',
                        done ? 'bg-emerald-100 text-emerald-700 cursor-default' : 'bg-primary text-primary-foreground hover:bg-primary/90')}>
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

function Section({ icon: Icon, title, tint, children }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2">
        <Icon className={cn('w-4 h-4', tint)} />
        <h4 className="text-xs font-bold uppercase tracking-wide text-foreground">{title}</h4>
      </div>
      <div className="pl-0.5">{children}</div>
    </div>
  );
}
