import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertTriangle, Loader2, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';

/**
 * Shared short-receival decision UI used by every receive surface (GRN drawer
 * modal, GRN-tab inline panel, Receive-Stock modal).
 *
 * Props:
 *   shortLines  – [{ id, product_name, product_sku, expected_qty, received_qty, unit_cost, purchase_uom }]
 *   onConfirm   – (payload) => void, where payload = { [lineId]: { action, expected_delivery_date, awaiting_qty, credit_qty } }
 *   onCancel    – () => void
 *   saving      – boolean
 *   confirmLabel – button text
 */
const OPTIONS = [
  { value: 'await_receival', label: 'Await remaining receival' },
  { value: 'request_credit', label: 'Request credit note' },
  { value: 'split',          label: 'Split by quantity' },
  { value: 'review',         label: 'Mark for review' },
];

const shortOf = (l) => (parseFloat(l.expected_qty) || 0) - (parseFloat(l.received_qty) || 0);

export default function ShortageDecisionPanel({ shortLines, onConfirm, onCancel, saving = false, confirmLabel = 'Finalise GRN' }) {
  const [state, setState] = useState(() =>
    Object.fromEntries(shortLines.map(l => {
      const short = shortOf(l);
      return [l.id, { action: 'await_receival', expected_delivery_date: '', awaiting_qty: String(short), credit_qty: '0' }];
    }))
  );

  const update = (id, patch) => setState(prev => ({ ...prev, [id]: { ...prev[id], ...patch } }));

  const handleConfirm = () => {
    // Validate split quantities add up to the shortage
    for (const l of shortLines) {
      const d = state[l.id];
      if (d.action === 'split') {
        const short = shortOf(l);
        const a = parseFloat(d.awaiting_qty) || 0;
        const c = parseFloat(d.credit_qty) || 0;
        if (Math.abs((a + c) - short) > 0.001) {
          toast.error(`${l.product_name}: "wait for" + "credit" must add up to ${short}`);
          return;
        }
      }
    }
    onConfirm(state);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
        <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
        <p className="text-xs text-amber-800">
          Some items were short-received. Choose how to handle each one — each product can take its own decision (split by product).
        </p>
      </div>

      <div className="border border-border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50 border-b border-border">
              <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Product</th>
              <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Expected</th>
              <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Received</th>
              <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Short</th>
              <th className="px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Decision</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {shortLines.map(l => {
              const short = shortOf(l);
              const d = state[l.id];
              return (
                <tr key={l.id}>
                  <td className="px-3 py-2 align-top">
                    <p className="font-medium">{l.product_name}</p>
                    <p className="text-[10px] font-mono text-muted-foreground">{l.product_sku}</p>
                  </td>
                  <td className="px-3 py-2 text-right text-muted-foreground align-top">{l.expected_qty}</td>
                  <td className="px-3 py-2 text-right align-top">{l.received_qty}</td>
                  <td className="px-3 py-2 text-right font-semibold text-amber-600 align-top">{short}</td>
                  <td className="px-3 py-2 min-w-[230px] align-top">
                    <Select value={d.action} onValueChange={v => update(l.id, { action: v })}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent className="z-[120]">
                        {OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                      </SelectContent>
                    </Select>

                    {d.action === 'await_receival' && (
                      <div className="mt-1.5">
                        <label className="text-[10px] text-muted-foreground">Expected next delivery</label>
                        <Input type="date" value={d.expected_delivery_date}
                          onChange={e => update(l.id, { expected_delivery_date: e.target.value })}
                          className="h-8 text-xs mt-0.5" />
                      </div>
                    )}

                    {d.action === 'split' && (
                      <div className="mt-1.5 grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[10px] text-muted-foreground">Wait for</label>
                          <Input type="number" min="0" max={short} step="0.001" value={d.awaiting_qty}
                            onChange={e => update(l.id, { awaiting_qty: e.target.value })}
                            className="h-8 text-xs mt-0.5 text-right" />
                        </div>
                        <div>
                          <label className="text-[10px] text-muted-foreground">Credit</label>
                          <Input type="number" min="0" max={short} step="0.001" value={d.credit_qty}
                            onChange={e => update(l.id, { credit_qty: e.target.value })}
                            className="h-8 text-xs mt-0.5 text-right" />
                        </div>
                        <p className="col-span-2 text-[10px] text-muted-foreground">Must add up to {short}.</p>
                        <div className="col-span-2">
                          <label className="text-[10px] text-muted-foreground">Expected next delivery (awaited part)</label>
                          <Input type="date" value={d.expected_delivery_date}
                            onChange={e => update(l.id, { expected_delivery_date: e.target.value })}
                            className="h-8 text-xs mt-0.5" />
                        </div>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="text-[11px] text-muted-foreground space-y-0.5">
        <p><strong>Await remaining receival</strong> — received stock is added; PO stays open; tracked until the rest arrives.</p>
        <p><strong>Request credit note</strong> — no more stock expected; a supplier credit is required.</p>
        <p><strong>Split by quantity</strong> — part awaited, part credited (both tracked on the one shortage).</p>
        <p><strong>Mark for review</strong> — flag it and decide later.</p>
      </div>

      <div className="flex gap-2 justify-end">
        <Button variant="outline" onClick={onCancel} disabled={saving}>Cancel</Button>
        <Button className="gap-2" onClick={handleConfirm} disabled={saving}>
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
          {confirmLabel}
        </Button>
      </div>
    </div>
  );
}
