import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { X, Loader2, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { formatPaymentTerms } from '@/lib/utils';

const CATEGORY_OPTIONS = [
  { value: 'food', label: 'Food' },
  { value: 'packaging', label: 'Packaging' },
  { value: 'resale', label: 'Resale' },
  { value: 'other', label: 'Other' },
];

const PAYMENT_TERM_TYPE_OPTIONS = [
  { value: 'immediate',              label: 'Immediate' },
  { value: 'days_after_invoice',     label: 'Days after invoice date' },
  { value: 'day_of_invoice_month',   label: 'Day of invoice month' },
  { value: 'day_of_following_month', label: 'Day of month following invoice' },
];

// Mirror of SupplierDetailDrawer.deriveLegacyTerms — keeps the legacy columns in sync.
function deriveLegacyTerms(type, value) {
  const v = parseInt(value) || 0;
  switch (type) {
    case 'immediate':              return { basis: 'invoice_date', days: 0, cutoff: null };
    case 'days_after_invoice':     return { basis: 'invoice_date', days: v, cutoff: null };
    case 'day_of_invoice_month':   return { basis: 'end_of_month_of_invoice', days: 0, cutoff: v };
    case 'day_of_following_month': return { basis: 'specific_day_of_month', days: 0, cutoff: v };
    default:                       return { basis: '', days: null, cutoff: null };
  }
}

/**
 * Bulk-edit shared fields across the selected suppliers. Only the fields whose
 * "Apply" toggle is on are written; the rest are left untouched per supplier.
 */
export default function SupplierBulkEditModal({ supplierIds = [], onCancel, onDone }) {
  const [saving, setSaving] = useState(false);
  // Which fields to apply
  const [apply, setApply] = useState({
    is_production_supplier: false,
    is_vat_registered: false,
    category: false,
    status: false,
    payment_terms: false,
  });
  // Values
  const [isProduction, setIsProduction] = useState(true);
  const [isVat, setIsVat] = useState(true);
  const [category, setCategory] = useState('food');
  const [status, setStatus] = useState('active');
  const [termType, setTermType] = useState('days_after_invoice');
  const [termValue, setTermValue] = useState('30');

  const toggleApply = (key) => setApply(prev => ({ ...prev, [key]: !prev[key] }));
  const anyApplied = Object.values(apply).some(Boolean);

  const buildPayload = () => {
    const payload = {};
    if (apply.is_production_supplier) payload.is_production_supplier = isProduction;
    if (apply.is_vat_registered) payload.is_vat_registered = isVat;
    if (apply.category) payload.category = category;
    if (apply.status) payload.status = status;
    if (apply.payment_terms) {
      const legacy = deriveLegacyTerms(termType, termValue);
      payload.payment_term_type = termType || null;
      payload.payment_term_value = termType && termType !== 'immediate' && termValue ? parseInt(termValue) : null;
      payload.payment_terms_basis = legacy.basis || null;
      payload.payment_terms_days = legacy.days;
      payload.payment_terms_cutoff_day = legacy.cutoff;
      payload.payment_terms_label = formatPaymentTerms(termType, termValue) || null;
    }
    return payload;
  };

  const handleSave = async () => {
    if (!anyApplied) { toast.error('Tick at least one field to apply'); return; }
    if (supplierIds.length === 0) { toast.error('No suppliers selected'); return; }
    const payload = buildPayload();
    setSaving(true);
    let ok = 0, fail = 0;
    for (const id of supplierIds) {
      try { await base44.entities.Supplier.update(id, payload); ok++; }
      catch { fail++; }
    }
    setSaving(false);
    if (fail) toast.error(`Updated ${ok}; ${fail} failed.`);
    else toast.success(`Updated ${ok} supplier${ok !== 1 ? 's' : ''}.`);
    onDone?.();
  };

  const Row = ({ field, label, children }) => (
    <div className="flex items-start gap-3 py-3 border-b border-border last:border-0">
      <label className="flex items-center gap-2 w-44 shrink-0 pt-1 cursor-pointer">
        <input type="checkbox" className="rounded w-4 h-4" checked={apply[field]} onChange={() => toggleApply(field)} />
        <span className="text-sm font-medium">{label}</span>
      </label>
      <div className={`flex-1 ${apply[field] ? '' : 'opacity-40 pointer-events-none'}`}>{children}</div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onCancel}>
      <div className="bg-card rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-border flex items-center justify-between shrink-0">
          <h2 className="text-base font-bold flex items-center gap-2">
            <Pencil className="w-4 h-4 text-primary" /> Bulk edit {supplierIds.length} supplier{supplierIds.length !== 1 ? 's' : ''}
          </h2>
          <Button variant="ghost" size="icon" onClick={onCancel}><X className="w-5 h-5" /></Button>
        </div>

        <div className="px-5 py-2 overflow-y-auto">
          <p className="text-xs text-muted-foreground py-2">Tick a field to apply it to all selected suppliers. Unticked fields are left unchanged.</p>

          <Row field="is_production_supplier" label="Production supplier">
            <div className="flex items-center gap-2 pt-1">
              <Switch checked={isProduction} onCheckedChange={setIsProduction} />
              <span className="text-sm text-muted-foreground">{isProduction ? 'Yes — production supplier' : 'No'}</span>
            </div>
          </Row>

          <Row field="is_vat_registered" label="VAT registered">
            <div className="flex items-center gap-2 pt-1">
              <Switch checked={isVat} onCheckedChange={setIsVat} />
              <span className="text-sm text-muted-foreground">{isVat ? 'Yes' : 'No'}</span>
            </div>
          </Row>

          <Row field="category" label="Category">
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CATEGORY_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </Row>

          <Row field="status" label="Status">
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </Row>

          <Row field="payment_terms" label="Payment terms">
            <div className="flex gap-2">
              <Select value={termType} onValueChange={setTermType}>
                <SelectTrigger className="h-9 flex-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PAYMENT_TERM_TYPE_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
              {termType !== 'immediate' && (
                <Input
                  type="number"
                  className="h-9 w-24"
                  value={termValue}
                  onChange={e => setTermValue(e.target.value)}
                  placeholder={termType === 'days_after_invoice' ? 'days' : 'day'}
                />
              )}
            </div>
          </Row>
        </div>

        <div className="px-5 py-3 border-t border-border flex justify-end gap-2 shrink-0">
          <Button variant="outline" onClick={onCancel} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !anyApplied} className="gap-2">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {saving ? 'Saving…' : `Apply to ${supplierIds.length}`}
          </Button>
        </div>
      </div>
    </div>
  );
}
