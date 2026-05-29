import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  X, CreditCard, Loader2, CheckCircle2, AlertTriangle, RotateCcw
} from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { writeAuditLog } from '@/lib/auditLog';

/**
 * Side drawer for matching a supplier credit note against open shortages / returns.
 * Props: { open, onClose, triggerItem, supplierId }
 */
export default function CreditNoteMatchingDrawer({ open, onClose, triggerItem, supplierId }) {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);

  // Credit note form
  const [cnNumber, setCnNumber] = useState('');
  const [cnDate, setCnDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [amountExclVat, setAmountExclVat] = useState('');
  const [vatAmount, setVatAmount] = useState('');
  const [notes, setNotes] = useState('');

  // Checked follow-up items and their allocations
  const [checkedIds, setCheckedIds] = useState(() =>
    triggerItem ? new Set([`${triggerItem._source}-${triggerItem.id}`]) : new Set()
  );
  const [allocations, setAllocations] = useState(() => {
    if (!triggerItem) return {};
    return { [`${triggerItem._source}-${triggerItem.id}`]: String(triggerItem._value || '') };
  });

  // Load all open follow-ups for this supplier
  const { data: shortages = [] } = useQuery({
    queryKey: ['supplier-shortages-for-cn', supplierId],
    queryFn: () => base44.entities.SupplierShortage.filter(
      { supplier_id: supplierId },
      '-created_date',
      200
    ),
    enabled: !!supplierId,
  });

  const { data: returns_ = [] } = useQuery({
    queryKey: ['supplier-returns-for-cn', supplierId],
    queryFn: () => base44.entities.SupplierReturn.filter(
      { supplier_id: supplierId },
      '-created_date',
      200
    ),
    enabled: !!supplierId,
  });

  // Combine into follow-up items for the checklist
  const followUpItems = useMemo(() => {
    const items = [];
    for (const s of shortages) {
      const status = s.credit_follow_up_status || 'credit_required';
      if (status === 'matched' || status === 'cancelled') continue;
      items.push({
        key: `shortage-${s.id}`,
        _source: 'shortage',
        id: s.id,
        label: s.product_name || s.product_sku || 'Shortage',
        sublabel: `Shortage · ${(s.shortage_qty || 0)} ${s.purchase_uom || ''}`,
        value: s.shortage_value,
        status,
        raw: s,
      });
    }
    for (const r of returns_) {
      if (!r.credit_expected) continue;
      if (r.status === 'credit_received') continue;
      items.push({
        key: `return-${r.id}`,
        _source: 'return',
        id: r.id,
        label: `Return ${r.return_number}`,
        sublabel: `Return · R ${(r.total_return_value || 0).toFixed(2)}`,
        value: r.total_return_value,
        status: r.credit_follow_up_status || 'credit_required',
        raw: r,
      });
    }
    return items;
  }, [shortages, returns_]);

  const totalExclVat = parseFloat(amountExclVat) || 0;
  const totalVat = parseFloat(vatAmount) || 0;
  const totalInclVat = Math.round((totalExclVat + totalVat) * 100) / 100;

  const totalAllocated = useMemo(() => {
    return Array.from(checkedIds).reduce((sum, key) => {
      return sum + (parseFloat(allocations[key]) || 0);
    }, 0);
  }, [checkedIds, allocations]);

  const toggleItem = (key, defaultValue) => {
    setCheckedIds(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
        setAllocations(a => ({ ...a, [key]: String(defaultValue || '') }));
      }
      return next;
    });
  };

  const handleSave = async () => {
    if (!cnNumber.trim()) {
      toast.error('Credit note number is required');
      return;
    }
    if (totalExclVat <= 0) {
      toast.error('Enter the credit note amount');
      return;
    }
    if (checkedIds.size === 0) {
      toast.error('Select at least one item to match');
      return;
    }

    setSaving(true);
    try {
      // 1. Create SupplierCreditNote record
      const supplier = shortages[0]?.supplier_name || returns_[0]?.supplier_name || '';
      const cn = await base44.entities.SupplierCreditNote.create({
        supplier_id: supplierId,
        supplier_name: supplier,
        credit_note_number: cnNumber.trim(),
        credit_note_date: cnDate,
        amount_excl_vat: totalExclVat,
        vat_amount: totalVat,
        total_incl_vat: totalInclVat,
        notes: notes.trim() || null,
        status: 'partially_matched', // will update below
      });

      // 2. Create match records + update follow-up statuses
      let allFullyCovered = true;
      for (const key of checkedIds) {
        const item = followUpItems.find(i => i.key === key);
        if (!item) continue;
        const allocated = parseFloat(allocations[key]) || 0;
        const itemValue = parseFloat(item.value) || 0;
        const isFullyCovered = itemValue > 0 && allocated >= itemValue * 0.99; // 1% tolerance

        if (!isFullyCovered) allFullyCovered = false;

        // Create match record
        await base44.entities.SupplierCreditNoteMatch.create({
          credit_note_id: cn.id,
          credit_note_number: cnNumber.trim(),
          supplier_id: supplierId,
          source_type: item._source,
          source_id: item.id,
          allocated_amount: allocated,
        });

        // Update follow-up status
        const newStatus = isFullyCovered ? 'matched' : 'partially_credited';
        if (item._source === 'shortage') {
          await base44.entities.SupplierShortage.update(item.id, {
            credit_follow_up_status: newStatus,
            credit_note_number: cnNumber.trim(),
            status: isFullyCovered ? 'resolved' : 'open',
          });
        } else {
          await base44.entities.SupplierReturn.update(item.id, {
            credit_follow_up_status: newStatus,
            credit_note_number: cnNumber.trim(),
            status: isFullyCovered ? 'credit_received' : 'returned',
          });
        }
      }

      // 3. Update credit note status
      await base44.entities.SupplierCreditNote.update(cn.id, {
        status: allFullyCovered ? 'fully_matched' : 'partially_matched',
      });

      writeAuditLog({
        action: 'create',
        entity_type: 'SupplierCreditNote',
        entity_id: cn.id,
        description: `Matched credit note ${cnNumber} — R ${totalInclVat.toFixed(2)} incl VAT — ${checkedIds.size} items`,
      });

      toast.success(`Credit note ${cnNumber} matched successfully`);
      queryClient.invalidateQueries({ queryKey: ['supplier-shortages'] });
      queryClient.invalidateQueries({ queryKey: ['supplier-returns'] });
      queryClient.invalidateQueries({ queryKey: ['supplier-shortages-for-cn', supplierId] });
      queryClient.invalidateQueries({ queryKey: ['supplier-returns-for-cn', supplierId] });
      onClose();
    } catch (err) {
      toast.error('Failed to save: ' + (err?.message || 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg bg-card shadow-2xl flex flex-col">
        {/* Header */}
        <div className="sticky top-0 bg-card border-b border-border px-6 py-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <CreditCard className="w-5 h-5 text-primary" />
            <h3 className="text-lg font-bold">Match Credit Note</h3>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="w-5 h-5" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          {/* CN form fields */}
          <div className="space-y-3">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase">Credit Note Details</h4>

            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase">Credit Note Number *</label>
              <Input
                className="mt-1"
                placeholder="e.g. CN-2024-001"
                value={cnNumber}
                onChange={e => setCnNumber(e.target.value)}
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase">Credit Note Date</label>
              <Input
                type="date"
                className="mt-1"
                value={cnDate}
                onChange={e => setCnDate(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase">Amount excl VAT *</label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  className="mt-1"
                  placeholder="0.00"
                  value={amountExclVat}
                  onChange={e => setAmountExclVat(e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase">VAT Amount</label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  className="mt-1"
                  placeholder="0.00"
                  value={vatAmount}
                  onChange={e => setVatAmount(e.target.value)}
                />
              </div>
            </div>

            <div className="flex items-center justify-between px-3 py-2 bg-muted/40 rounded-lg">
              <span className="text-sm text-muted-foreground">Total incl VAT</span>
              <span className="font-bold">R {totalInclVat.toFixed(2)}</span>
            </div>

            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase">Notes (optional)</label>
              <Textarea
                className="mt-1 h-16"
                placeholder="Any additional notes..."
                value={notes}
                onChange={e => setNotes(e.target.value)}
              />
            </div>
          </div>

          {/* Follow-up checklist */}
          <div className="space-y-2">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase">
              Match Against Open Follow-ups ({followUpItems.length})
            </h4>

            {followUpItems.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No open follow-ups found for this supplier.
              </p>
            ) : (
              <div className="space-y-2">
                {followUpItems.map(item => {
                  const isChecked = checkedIds.has(item.key);
                  const isTrigger = triggerItem && item._source === triggerItem._source && item.id === triggerItem.id;

                  return (
                    <div
                      key={item.key}
                      className={`border rounded-lg p-3 transition-all ${
                        isChecked
                          ? 'border-primary bg-primary/5'
                          : 'border-border hover:bg-muted/20'
                      }`}
                    >
                      <button
                        className="w-full text-left"
                        onClick={() => toggleItem(item.key, item.value)}
                      >
                        <div className="flex items-start justify-between">
                          <div>
                            <div className="flex items-center gap-2 text-sm font-medium">
                              {item._source === 'shortage' ? (
                                <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                              ) : (
                                <RotateCcw className="w-3.5 h-3.5 text-blue-500" />
                              )}
                              {item.label}
                              {isTrigger && (
                                <Badge className="text-[9px] bg-primary/10 text-primary">Selected</Badge>
                              )}
                            </div>
                            <div className="text-xs text-muted-foreground mt-0.5 ml-5">{item.sublabel}</div>
                          </div>
                          <div className="text-sm font-semibold">
                            R {(parseFloat(item.value) || 0).toFixed(2)}
                          </div>
                        </div>
                      </button>

                      {isChecked && (
                        <div className="mt-2 pt-2 border-t border-border">
                          <label className="text-[10px] text-muted-foreground uppercase">Allocated Amount</label>
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            className="h-8 text-sm mt-0.5"
                            value={allocations[item.key] || ''}
                            onChange={e => setAllocations(a => ({ ...a, [item.key]: e.target.value }))}
                            onClick={e => e.stopPropagation()}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {checkedIds.size > 0 && (
              <div className="flex items-center justify-between text-sm px-1">
                <span className="text-muted-foreground">Total allocated</span>
                <span className={`font-semibold ${Math.abs(totalAllocated - totalExclVat) < 0.01 ? 'text-green-600' : 'text-amber-600'}`}>
                  R {totalAllocated.toFixed(2)}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-card border-t border-border px-6 py-4 shrink-0 flex gap-3">
          <Button variant="outline" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button
            className="flex-1 gap-2"
            onClick={handleSave}
            disabled={saving || !cnNumber.trim() || totalExclVat <= 0 || checkedIds.size === 0}
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            {saving ? 'Saving...' : 'Save Match'}
          </Button>
        </div>
      </div>
    </div>
  );
}
