import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Truck, Plus, Trash2, Loader2, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';

const CHARGE_TYPES = [
  { value: 'shipping', label: 'Shipping' },
  { value: 'freight', label: 'Freight' },
  { value: 'customs', label: 'Customs' },
  { value: 'duty', label: 'Import duty' },
  { value: 'handling', label: 'Handling' },
  { value: 'insurance', label: 'Insurance' },
  { value: 'other', label: 'Other' },
];

/**
 * Additional / landed-cost charges on a purchase invoice (shipping, freight…).
 * These are CAPITALISED — spread across the invoice's stock units by value — when
 * the goods are received (GRN), raising each unit's cost. They are not expensed.
 */
export default function InvoiceChargesPanel({ invoice, canEdit }) {
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ charge_type: 'shipping', description: '', amount: '' });
  const set = (k, v) => setForm(prev => ({ ...prev, [k]: v }));

  const { data: charges = [], isLoading } = useQuery({
    queryKey: ['invoice-charges', invoice.id],
    queryFn: () => base44.entities.PurchaseInvoiceCharge.filter({ invoice_id: invoice.id }, '-created_date', 50),
  });

  const total = useMemo(() => charges.reduce((s, c) => s + (Number(c.amount) || 0), 0), [charges]);
  const anyAllocated = charges.some(c => c.allocated);
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['invoice-charges', invoice.id] });

  const handleAdd = async () => {
    const amt = parseFloat(form.amount);
    if (!(amt > 0)) { toast.error('Enter a charge amount'); return; }
    setAdding(true);
    try {
      await base44.entities.PurchaseInvoiceCharge.create({
        invoice_id: invoice.id,
        charge_type: form.charge_type,
        description: form.description.trim() || null,
        amount: amt,
        allocation_method: 'by_value',
        allocated: false,
      });
      setForm({ charge_type: 'shipping', description: '', amount: '' });
      invalidate();
      toast.success('Charge added — it will be capitalised across the units when received');
    } catch (err) {
      toast.error('Failed to add charge: ' + (err.message || 'unknown error'));
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (c) => {
    if (c.allocated) { toast.error('This charge is already capitalised into a receipt and cannot be removed'); return; }
    try {
      await base44.entities.PurchaseInvoiceCharge.delete(c.id);
      invalidate();
    } catch (err) {
      toast.error('Failed to remove charge');
    }
  };

  return (
    <div className="px-6 py-4 border-t border-border">
      <div className="flex items-center gap-2 mb-1">
        <Truck className="w-4 h-4 text-primary" />
        <h4 className="text-sm font-semibold">Additional charges (landed cost)</h4>
      </div>
      <p className="text-[11px] text-muted-foreground mb-3">
        One-off costs like shipping or freight. Capitalised <span className="font-medium">by value</span> across
        this invoice's stock units when the delivery is received — raising each unit's cost price (not expensed).
      </p>

      {isLoading ? (
        <div className="text-xs text-muted-foreground py-2">Loading charges…</div>
      ) : charges.length === 0 ? (
        <div className="text-xs text-muted-foreground py-2">No additional charges on this invoice yet.</div>
      ) : (
        <div className="border border-border rounded-lg divide-y divide-border mb-3">
          {charges.map(c => (
            <div key={c.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="capitalize font-medium w-24 shrink-0">{c.charge_type}</span>
              <span className="flex-1 text-muted-foreground truncate">{c.description || '—'}</span>
              {c.allocated ? (
                <span className="inline-flex items-center gap-1 text-[10px] text-green-600 shrink-0" title="Capitalised into a receipt">
                  <CheckCircle2 className="w-3.5 h-3.5" /> capitalised
                </span>
              ) : (
                <span className="text-[10px] text-amber-600 shrink-0">pending receipt</span>
              )}
              <span className="tabular-nums font-medium w-24 text-right shrink-0">R {(Number(c.amount) || 0).toFixed(2)}</span>
              {canEdit && !c.allocated && (
                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => handleDelete(c)} title="Remove charge">
                  <Trash2 className="w-3.5 h-3.5 text-muted-foreground" />
                </Button>
              )}
            </div>
          ))}
          <div className="flex items-center justify-between px-3 py-2 bg-muted/30 text-sm font-semibold">
            <span>Total charges</span>
            <span className="tabular-nums">R {total.toFixed(2)}</span>
          </div>
        </div>
      )}

      {canEdit && (
        <div className="flex items-end gap-2 flex-wrap">
          <div className="w-32">
            <label className="text-[10px] uppercase text-muted-foreground font-semibold block mb-1">Type</label>
            <Select value={form.charge_type} onValueChange={v => set('charge_type', v)}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CHARGE_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex-1 min-w-[140px]">
            <label className="text-[10px] uppercase text-muted-foreground font-semibold block mb-1">Description</label>
            <Input value={form.description} onChange={e => set('description', e.target.value)} placeholder="e.g. courier to PE" className="h-9" />
          </div>
          <div className="w-28">
            <label className="text-[10px] uppercase text-muted-foreground font-semibold block mb-1">Amount (excl. VAT)</label>
            <Input type="number" step="0.01" min="0" value={form.amount} onChange={e => set('amount', e.target.value)} placeholder="0.00" className="h-9" />
          </div>
          <Button className="h-9 gap-1.5" onClick={handleAdd} disabled={adding}>
            {adding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            Add
          </Button>
        </div>
      )}

      {anyAllocated && (
        <p className="text-[10px] text-muted-foreground mt-2">
          Capitalised charges are locked — they've already been folded into received stock costs.
        </p>
      )}
    </div>
  );
}
