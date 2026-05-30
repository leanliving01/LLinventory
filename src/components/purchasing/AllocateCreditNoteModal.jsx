import React, { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { X, CreditCard, Loader2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { computeShortageValue, allocateCreditNote } from '@/lib/shortageEngine';

/**
 * Allocate a supplier credit note against an awaiting-credit shortage.
 * Props: { shortage, onAllocated, onCancel }
 */
export default function AllocateCreditNoteModal({ shortage, onAllocated, onCancel }) {
  const expected = useMemo(
    () => computeShortageValue(shortage.shortage_qty, shortage.unit_cost),
    [shortage]
  );
  const [creditNoteNumber, setCreditNoteNumber] = useState('');
  const [creditNoteDate, setCreditNoteDate] = useState(new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState(String(expected));
  const [saving, setSaving] = useState(false);

  const actual = parseFloat(amount) || 0;
  const variance = Math.round((actual - expected) * 100) / 100;
  const matched = Math.abs(variance) < 0.01;

  const handleSave = async () => {
    if (!creditNoteNumber.trim()) { toast.error('Enter the credit note number'); return; }
    if (!creditNoteDate) { toast.error('Enter the credit note date'); return; }
    setSaving(true);
    try {
      await allocateCreditNote(shortage, {
        creditNoteNumber: creditNoteNumber.trim(),
        creditNoteDate,
        amountActual: actual,
      });
      toast.success(matched ? 'Credit note allocated — shortage resolved' : 'Credit note allocated with variance');
      onAllocated();
    } catch (err) {
      toast.error('Failed: ' + (err?.message || 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-[200]" onClick={onCancel} />
      <div className="fixed inset-0 z-[210] flex items-center justify-center p-4">
        <div className="bg-card rounded-xl shadow-2xl w-full max-w-md p-6 space-y-4">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2">
              <CreditCard className="w-5 h-5 text-purple-600" />
              <h3 className="font-semibold text-base">Allocate Credit Note</h3>
            </div>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onCancel}><X className="w-4 h-4" /></Button>
          </div>

          <div className="rounded-lg bg-muted/40 p-3 text-sm">
            <p className="font-medium">{shortage.product_name}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Short {shortage.shortage_qty} {shortage.purchase_uom} · unit R {(parseFloat(shortage.unit_cost) || 0).toFixed(2)}
            </p>
            <p className="text-xs mt-1">Expected credit: <span className="font-semibold">R {expected.toFixed(2)}</span></p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase">Credit Note Number *</label>
              <Input value={creditNoteNumber} onChange={e => setCreditNoteNumber(e.target.value)} placeholder="e.g. SCN-001" className="mt-1" />
            </div>
            <div>
              <label className="text-[10px] font-semibold text-muted-foreground uppercase">Credit Note Date *</label>
              <Input type="date" value={creditNoteDate} onChange={e => setCreditNoteDate(e.target.value)} className="mt-1" />
            </div>
            <div>
              <label className="text-[10px] font-semibold text-muted-foreground uppercase">Amount Credited *</label>
              <Input type="number" step="0.01" min="0" value={amount} onChange={e => setAmount(e.target.value)} className="mt-1 text-right" />
            </div>
          </div>

          {!matched && actual > 0 && (
            <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 text-xs">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>
                Variance of <strong>R {variance.toFixed(2)}</strong> ({variance > 0 ? 'over' : 'under'} expected).
                The shortage will stay <strong>partially credited</strong> until resolved.
              </span>
            </div>
          )}
          {matched && (
            <p className="text-xs text-green-700">Amount matches the expected credit — the shortage will be resolved.</p>
          )}

          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={onCancel}>Cancel</Button>
            <Button className="flex-1 gap-2" onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />}
              Allocate
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
