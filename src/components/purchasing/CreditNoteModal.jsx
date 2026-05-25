import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { X, Loader2, CreditCard, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';

export default function CreditNoteModal({ po, onCreated, onCancel }) {
  const [saving, setSaving] = useState(false);
  const [creditNoteNumber, setCreditNoteNumber] = useState('');
  const [creditDate, setCreditDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [returnGoods, setReturnGoods] = useState(false);
  const [lineCredits, setLineCredits] = useState({});

  const { data: poLines = [] } = useQuery({
    queryKey: ['po-lines', po.id],
    queryFn: () => base44.entities.PurchaseOrderLine.filter({ purchase_order_id: po.id }, 'created_date', 100),
  });

  const { data: existingInvoices = [] } = useQuery({
    queryKey: ['po-invoices', po.id],
    queryFn: () => base44.entities.PurchaseInvoice.filter({ purchase_order_id: po.id }),
  });

  const linkedInvoice = useMemo(() => existingInvoices.find(i => !i.is_credit_note), [existingInvoices]);

  const getCredit = (lineId, field) => {
    const line = poLines.find(l => l.id === lineId);
    if (!line) return '';
    const overrides = lineCredits[lineId] || {};
    if (field === 'qty') return overrides.qty !== undefined ? overrides.qty : '';
    if (field === 'unit_cost') return overrides.unit_cost !== undefined ? overrides.unit_cost : String(line.unit_cost || '');
    if (field === 'included') return overrides.included !== undefined ? overrides.included : false;
    return '';
  };

  const setCredit = (lineId, field, value) => {
    setLineCredits(prev => ({ ...prev, [lineId]: { ...prev[lineId], [field]: value } }));
  };

  const creditLines = poLines
    .filter(l => getCredit(l.id, 'included'))
    .map(l => ({
      ...l,
      credit_qty: Number(getCredit(l.id, 'qty')) || 0,
      credit_unit_cost: Number(getCredit(l.id, 'unit_cost')) || 0,
    }))
    .filter(l => l.credit_qty > 0);

  const creditSubtotal = creditLines.reduce((s, l) => s + l.credit_qty * l.credit_unit_cost, 0);
  const creditTax = Math.round(creditSubtotal * 0.15 * 100) / 100;
  const creditTotal = creditSubtotal + creditTax;

  const handleCreate = async () => {
    if (!creditNoteNumber.trim()) { toast.error('Enter the credit note number from your supplier'); return; }
    if (creditLines.length === 0) { toast.error('Select at least one line item to credit'); return; }

    setSaving(true);
    try {
      // Create credit note invoice
      const creditNote = await base44.entities.PurchaseInvoice.create({
        invoice_number: creditNoteNumber.trim(),
        supplier_id: po.supplier_id,
        supplier_name: po.supplier_name,
        purchase_order_id: po.id,
        linked_invoice_id: linkedInvoice?.id || null,
        invoice_date: creditDate,
        is_credit_note: true,
        subtotal: -Math.round(creditSubtotal * 100) / 100,
        tax_amount: -creditTax,
        total: -Math.round(creditTotal * 100) / 100,
        currency: 'ZAR',
        status: 'approved',
        payment_status: 'credit_applied',
        source: 'manual',
        credited_amount: Math.round(creditTotal * 100) / 100,
        notes: notes || null,
      });

      // Update linked invoice's credited_amount
      if (linkedInvoice) {
        const newCredited = (linkedInvoice.credited_amount || 0) + Math.round(creditTotal * 100) / 100;
        await base44.entities.PurchaseInvoice.update(linkedInvoice.id, {
          credited_amount: Math.round(newCredited * 100) / 100,
        });
      }

      // Create negative stock movements if goods are physically returned
      if (returnGoods) {
        for (const l of creditLines) {
          if (!l.product_id || l.credit_qty <= 0) continue;
          await base44.entities.StockMovement.create({
            product_id: l.product_id,
            product_sku: l.product_sku || '',
            product_name: l.product_name || '',
            from_location_id: po.location_id || null,
            qty: -l.credit_qty,
            uom: l.uom || 'pcs',
            reason: 'supplier_return',
            ref_type: 'credit_note',
            ref_id: creditNote.id,
            ref_number: creditNoteNumber.trim(),
            unit_cost_at_movement: l.credit_unit_cost,
            notes: `Credit note ${creditNoteNumber} — supplier return against ${po.po_number}`,
          });
        }
      }

      toast.success(`Credit note ${creditNoteNumber} recorded${returnGoods ? ' — stock movements created' : ''}`);
      onCreated(creditNote);
    } catch (err) {
      console.error('[CreditNoteModal]', err);
      toast.error(`Failed: ${err.message || 'Unknown error'}`);
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4">
      <div className="bg-card w-full max-w-2xl rounded-xl shadow-xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <CreditCard className="w-5 h-5 text-primary" />
            <h3 className="text-lg font-bold">Issue Credit Note</h3>
            <span className="text-xs text-muted-foreground">against {po.po_number}</span>
          </div>
          <Button variant="ghost" size="icon" onClick={onCancel}><X className="w-5 h-5" /></Button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {!linkedInvoice && (
            <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <p>No purchase invoice found for this PO. The credit note will be recorded but cannot be linked to an original invoice.</p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase">Credit Note Number *</label>
              <Input value={creditNoteNumber} onChange={e => setCreditNoteNumber(e.target.value)} placeholder="e.g. CN-2024-001" className="mt-1" />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase">Credit Date</label>
              <Input type="date" value={creditDate} onChange={e => setCreditDate(e.target.value)} className="mt-1" />
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase">Reason / Notes</label>
            <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Damaged goods, overcharge, return, etc." className="mt-1" />
          </div>

          {/* Lines */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">Select Lines to Credit</p>
            <div className="border border-border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/50 border-b border-border">
                    <th className="w-8 px-3 py-2"></th>
                    <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Product</th>
                    <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase w-24">Credit Qty</th>
                    <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase w-28">Unit Cost</th>
                    <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase w-24">Credit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {poLines.map(line => {
                    const included = getCredit(line.id, 'included');
                    const qty = getCredit(line.id, 'qty');
                    const cost = getCredit(line.id, 'unit_cost');
                    const lineCredit = (Number(qty) || 0) * (Number(cost) || 0);
                    return (
                      <tr key={line.id} className={included ? 'bg-primary/5' : ''}>
                        <td className="px-3 py-2">
                          <Checkbox
                            checked={!!included}
                            onCheckedChange={v => {
                              setCredit(line.id, 'included', v);
                              if (v && !getCredit(line.id, 'qty')) {
                                setCredit(line.id, 'qty', String(line.ordered_qty || ''));
                              }
                            }}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <p className="text-xs font-medium">{line.product_name}</p>
                          <p className="text-[10px] font-mono text-muted-foreground">{line.product_sku}</p>
                        </td>
                        <td className="px-2 py-1">
                          <Input
                            type="number"
                            value={qty}
                            onChange={e => setCredit(line.id, 'qty', e.target.value)}
                            disabled={!included}
                            placeholder={String(line.ordered_qty || 0)}
                            className="h-8 text-xs text-right"
                            min="0"
                            max={String(line.ordered_qty || 9999)}
                          />
                        </td>
                        <td className="px-2 py-1">
                          <Input
                            type="number"
                            value={cost}
                            onChange={e => setCredit(line.id, 'unit_cost', e.target.value)}
                            disabled={!included}
                            className="h-8 text-xs text-right"
                            min="0"
                            step="0.01"
                          />
                        </td>
                        <td className="px-3 py-2 text-right text-xs font-medium">
                          {included && lineCredit > 0 ? `R ${lineCredit.toFixed(2)}` : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Return goods toggle */}
          <div className="flex items-start gap-3 p-3 rounded-lg border border-border bg-muted/30">
            <Checkbox id="return-goods" checked={returnGoods} onCheckedChange={setReturnGoods} className="mt-0.5" />
            <div>
              <label htmlFor="return-goods" className="text-sm font-medium cursor-pointer">Goods are being physically returned</label>
              <p className="text-xs text-muted-foreground mt-0.5">Creates negative stock movements to remove the credited quantity from inventory</p>
            </div>
          </div>

          {/* Totals */}
          {creditSubtotal > 0 && (
            <div className="bg-muted/50 rounded-lg p-4 space-y-1 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Credit Subtotal</span><span className="text-destructive">- R {creditSubtotal.toFixed(2)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">VAT (15%)</span><span className="text-destructive">- R {creditTax.toFixed(2)}</span></div>
              <div className="flex justify-between font-bold text-base pt-1 border-t border-border"><span>Credit Total</span><span className="text-destructive">- R {creditTotal.toFixed(2)}</span></div>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-border shrink-0 flex gap-3">
          <Button variant="outline" className="flex-1" onClick={onCancel}>Cancel</Button>
          <Button className="flex-1 gap-2 bg-destructive hover:bg-destructive/90" onClick={handleCreate} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />}
            Record Credit Note
          </Button>
        </div>
      </div>
    </div>
  );
}
