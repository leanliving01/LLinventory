import React, { useState, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ArrowLeft, Factory, AlertTriangle, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Full-page review of the split-run plan.
 * Receives plan data via sessionStorage (set by ProductionPlanning before navigating here).
 * Shows each run with its lines, lets the user review, then creates the runs.
 */
import { base44 } from '@/api/base44Client';
import { useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { writeAuditLog } from '@/lib/auditLog';
import MachineLoadPanel from '@/components/production/MachineLoadPanel';
import ProductionFlowPanel from '@/components/production/ProductionFlowPanel';
import LivyPlanRead from '@/components/production/LivyPlanRead';

export default function PlanRunReview() {
  const queryClient = useQueryClient();
  const [generating, setGenerating] = useState(false);

  // Load plan data from sessionStorage
  const planData = useMemo(() => {
    const raw = sessionStorage.getItem('planRunReview');
    if (!raw) return null;
    return JSON.parse(raw);
  }, []);

  // Local state for editing quantities within runs
  const [overrides, setOverrides] = useState({});
  // Livy's suggested adjustments (for the learning loop on confirm).
  const [livySuggestions, setLivySuggestions] = useState([]);
  const handleSuggestions = useCallback((s) => setLivySuggestions(s || []), []);

  const initialPlan = planData?.splitPlan || [];
  const maxPerRun = planData?.maxPerRun || 1500;

  // Apply overrides to the plan
  const splitPlan = useMemo(() => {
    return initialPlan.map(run => {
      const updatedLines = run.lines.map(l => {
        const key = `${run.runIndex}-${l.product_id}`;
        const qty = overrides[key] !== undefined ? Number(overrides[key]) : l.planned_qty;
        return { ...l, planned_qty: qty };
      });
      return {
        ...run,
        lines: updatedLines,
        totalUnits: updatedLines.reduce((s, l) => s + l.planned_qty, 0),
      };
    });
  }, [initialPlan, overrides]);

  // All planned meal lines across every run — the machine load is shared, so the
  // daily kitchen breakdown is the sum of the whole plan. Full line objects
  // (carry soh/committed/par) so Livy's read has the priority context too.
  // (Declared before the early return below to keep hook order stable.)
  const allPlanLines = useMemo(
    () => splitPlan.flatMap(r => r.lines.filter(l => l.planned_qty > 0)),
    [splitPlan]
  );

  // Apply one of Livy's suggested quantities (by SKU) into the plan. If a meal is
  // split across runs, put the new total on the first (priority) line and zero
  // the rest, so the engine/machine load reflects the single new total. (Declared
  // before the early return below to keep hook order stable.)
  const applyLivyQty = useCallback((sku, toQty) => {
    const matches = [];
    splitPlan.forEach(run => run.lines.forEach(l => {
      if (l.product_sku === sku) matches.push({ runIndex: run.runIndex, productId: l.product_id });
    }));
    if (matches.length === 0) return;
    setOverrides(prev => {
      const next = { ...prev };
      matches.forEach((m, i) => { next[`${m.runIndex}-${m.productId}`] = String(i === 0 ? toQty : 0); });
      return next;
    });
    toast.success(`Set ${sku} to ${toQty} (Livy)`);
  }, [splitPlan]);

  // Learning loop: when the manager confirms the run, tell Livy the final makes
  // and how it treated Livy's suggestions, so Livy saves a durable preference to
  // its Production brain (brain_write) and recalls it next time. Fire-and-forget
  // (keepalive so it survives the redirect); best-effort, never blocks the UI.
  const teachLivy = useCallback((runs) => {
    if (!livySuggestions.length) return; // only learn when Livy actually weighed in
    const finalBySku = {};
    runs.forEach(run => run.lines.forEach(l => {
      if ((l.planned_qty || 0) > 0) finalBySku[l.product_sku] = (finalBySku[l.product_sku] || 0) + l.planned_qty;
    }));
    const outcomes = livySuggestions.map(s => ({
      sku: s.sku, name: s.name, livy_suggested: Number(s.to_qty),
      manager_final: finalBySku[s.sku] ?? 0,
      followed: (finalBySku[s.sku] ?? 0) === Number(s.to_qty),
    }));
    const system = {
      role: 'system',
      content:
        "You are Livy. The Lean Living production manager just CONFIRMED today's production run. Below is how they treated your suggested quantity adjustments. " +
        "If there's a durable preference worth learning (e.g. they consistently make more/less of something than you propose, ignore a certain kind of suggestion, or favour certain ranges), save ONE concise note to your Production brain via brain_write so you plan better next time. " +
        "If nothing is notable, do nothing. Be brief; reply with one short sentence.",
    };
    const user = { role: 'user', content: 'Suggestion outcomes:\n```json\n' + JSON.stringify(outcomes) + '\n```' };
    try {
      fetch('/__fn/livy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-5.4', stream: false, messages: [system, user] }),
        keepalive: true,
      }).catch(() => { /* best-effort learning */ });
    } catch { /* ignore */ }
  }, [livySuggestions]);

  if (!planData) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Link to="/production"><Button variant="ghost" size="icon"><ArrowLeft className="w-4 h-4" /></Button></Link>
          <h1 className="text-2xl font-bold">Plan Run Review</h1>
        </div>
        <div className="text-center py-16 bg-card border rounded-xl">
          <p className="text-muted-foreground">No plan data found. Go back to Production Planning to generate a plan.</p>
        </div>
      </div>
    );
  }

  const grandTotal = splitPlan.reduce((s, r) => s + r.totalUnits, 0);

  const handleQtyChange = (runIndex, productId, value) => {
    const key = `${runIndex}-${productId}`;
    setOverrides(prev => ({ ...prev, [key]: value }));
  };

  const handleCreateRuns = async () => {
    setGenerating(true);
    try {
      const today = format(new Date(), 'yyyy-MM-dd');
      const baseTs = Date.now();
      let totalCreated = 0;

      for (let i = 0; i < splitPlan.length; i++) {
        const run = splitPlan[i];
        const activeLines = run.lines.filter(l => l.planned_qty > 0);
        if (activeLines.length === 0) continue;

        const suffix = splitPlan.length > 1 ? String.fromCharCode(65 + i) : '';
        const runNumber = `RUN-${format(new Date(), 'yyyy')}-${String(baseTs + i).slice(-4)}${suffix}`;
        const runTotal = activeLines.reduce((s, l) => s + l.planned_qty, 0);

        const created = await base44.entities.ProductionRun.create({
          run_number: runNumber,
          run_date: today,
          status: 'scheduled',
          total_lines: activeLines.length,
          total_units: runTotal,
          notes: splitPlan.length > 1 ? `Split ${i + 1} of ${splitPlan.length}${i === 0 ? ' (priority run)' : ''}` : '',
        });

        const linesWithRun = activeLines.map(l => ({ ...l, run_id: created.id, status: 'pending' }));
        await base44.entities.ProductionRunLine.bulkCreate(linesWithRun);

        writeAuditLog({
          action: 'create',
          entity_type: 'ProductionRun',
          entity_id: created.id,
          description: `Created production run ${runNumber} — ${activeLines.length} meals, ${runTotal} units${splitPlan.length > 1 ? ` (split ${i + 1}/${splitPlan.length})` : ''}`,
        });
        totalCreated++;
      }

      queryClient.invalidateQueries({ queryKey: ['production-runs'] });
      // The new runs are now in-flight cover — refresh so a return to planning
      // doesn't reuse stale cover and double-produce.
      queryClient.invalidateQueries({ queryKey: ['production-in-flight'] });
      sessionStorage.removeItem('planRunReview');
      teachLivy(splitPlan); // best-effort: let Livy learn from the confirmed plan
      toast.success(`Created ${totalCreated} production run${totalCreated > 1 ? 's' : ''} — ${grandTotal.toLocaleString()} total meals`);
      window.location.href = '/production/runs';
    } catch (err) {
      console.error('[PlanRunReview] creation failed:', err);
      toast.error(`Failed to create run${splitPlan.length > 1 ? 's' : ''}: ${err.message}`);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link to="/production">
          <Button variant="ghost" size="icon"><ArrowLeft className="w-4 h-4" /></Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">Review Production Plan</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {format(new Date(), 'EEEE, dd MMM yyyy')} — {grandTotal.toLocaleString()} meals across {splitPlan.length} run{splitPlan.length > 1 ? 's' : ''}
            {splitPlan.length > 1 && ` (max ${maxPerRun.toLocaleString()} per run)`}
          </p>
        </div>
        <Button
          onClick={handleCreateRuns}
          disabled={generating || grandTotal === 0}
          size="lg"
          className="gap-2 h-12 px-8 text-base"
        >
          {generating ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <Factory className="w-5 h-5" />
          )}
          {generating ? 'Creating...' : `Create ${splitPlan.length} Run${splitPlan.length > 1 ? 's' : ''}`}
        </Button>
      </div>

      {/* Split warning */}
      {splitPlan.length > 1 && (
        <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm">
          <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
          <div>
            <span className="font-semibold text-amber-800">Split across {splitPlan.length} runs</span>
            <p className="text-amber-700 mt-0.5">
              Total exceeds {maxPerRun.toLocaleString()} meals per run.
              Run 1 is prioritised with the highest committed demand to cover immediate orders.
              You can adjust quantities in each run before creating.
            </p>
          </div>
        </div>
      )}

      {/* Livy's read — judgment + one-tap adjustments on top of the engine's plan */}
      <LivyPlanRead lines={allPlanLines} onApply={applyLivyQty} onSuggestions={handleSuggestions} dailyCapacity={maxPerRun} productionDays={splitPlan.length} />

      {/* Production flow — the recommended cook order + portioning start */}
      <ProductionFlowPanel lines={allPlanLines} />

      {/* Machine load breakdown — how the plan splits across the kitchen */}
      <MachineLoadPanel lines={allPlanLines} />

      {/* Runs */}
      {splitPlan.map((run) => (
        <RunCard
          key={run.runIndex}
          run={run}
          numRuns={splitPlan.length}
          maxPerRun={maxPerRun}
          onQtyChange={handleQtyChange}
          overrides={overrides}
        />
      ))}

      {/* Bottom action bar */}
      <div className="flex items-center justify-between bg-card border border-border rounded-xl px-6 py-4">
        <div className="flex items-center gap-6">
          <div>
            <p className="text-[10px] text-muted-foreground uppercase font-semibold">Total Runs</p>
            <p className="text-xl font-bold">{splitPlan.length}</p>
          </div>
          <div className="w-px h-8 bg-border" />
          <div>
            <p className="text-[10px] text-muted-foreground uppercase font-semibold">Grand Total</p>
            <p className="text-xl font-bold">{grandTotal.toLocaleString()} meals</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Link to="/production">
            <Button variant="outline">Back to Planning</Button>
          </Link>
          <Button
            onClick={handleCreateRuns}
            disabled={generating || grandTotal === 0}
            size="lg"
            className="gap-2"
          >
            {generating ? <Loader2 className="w-5 h-5 animate-spin" /> : <Factory className="w-5 h-5" />}
            {generating ? 'Creating...' : `Confirm & Create ${splitPlan.length} Run${splitPlan.length > 1 ? 's' : ''}`}
          </Button>
        </div>
      </div>
    </div>
  );
}

function RunCard({ run, numRuns, maxPerRun, onQtyChange, overrides }) {
  const overMax = run.totalUnits > maxPerRun;

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      {/* Run header */}
      <div className={cn(
        "px-6 py-4 flex items-center justify-between border-b border-border",
        run.runIndex === 0 ? "bg-primary/5" : "bg-muted/30"
      )}>
        <div className="flex items-center gap-3">
          <Factory className="w-5 h-5 text-primary" />
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-base">{run.label}</span>
              {run.runIndex === 0 && numRuns > 1 && (
                <Badge className="bg-primary/20 text-primary text-[10px]">Priority</Badge>
              )}
              {overMax && (
                <Badge className="bg-red-100 text-red-700 text-[10px] gap-1">
                  <AlertTriangle className="w-3 h-3" /> Over max
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              {run.lines.length} meals · {run.totalUnits.toLocaleString()} units
            </p>
          </div>
        </div>
      </div>

      {/* Lines table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-[10px] text-muted-foreground uppercase bg-muted/20">
              <th className="text-left px-4 py-2 font-semibold">Meal</th>
              <th className="text-left px-3 py-2 font-semibold">SKU</th>
              <th className="text-right px-3 py-2 font-semibold">SOH</th>
              <th className="text-right px-3 py-2 font-semibold">COM</th>
              <th className="text-right px-3 py-2 font-semibold">PAR</th>
              <th className="text-center px-3 py-2 font-semibold">Qty</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {run.lines.map((l, i) => {
              const key = `${run.runIndex}-${l.product_id}`;
              const qty = overrides[key] !== undefined ? overrides[key] : l.planned_qty;
              return (
                <tr key={`${l.product_id}-${i}`} className="hover:bg-muted/20">
                  <td className="px-4 py-2 text-xs font-medium">{l.product_name}</td>
                  <td className="px-3 py-2 text-xs font-mono text-muted-foreground">{l.product_sku}</td>
                  <td className="px-3 py-2 text-xs text-right tabular-nums">{l.soh_at_plan}</td>
                  <td className="px-3 py-2 text-xs text-right tabular-nums text-amber-600">{l.committed_at_plan || '—'}</td>
                  <td className="px-3 py-2 text-xs text-right tabular-nums">{l.par_at_plan || '—'}</td>
                  <td className="px-3 py-2 text-center">
                    <Input
                      type="number"
                      min="0"
                      value={qty}
                      onChange={e => onQtyChange(run.runIndex, l.product_id, e.target.value)}
                      className="w-20 text-right h-8 text-xs mx-auto"
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="bg-muted/30 border-t border-border">
              <td colSpan={5} className="px-4 py-3 text-sm font-bold">Run Total</td>
              <td className="px-3 py-3 text-center text-sm font-bold tabular-nums">{run.totalUnits.toLocaleString()}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}