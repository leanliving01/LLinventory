import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { X, Loader2, Truck } from 'lucide-react';
import { toast } from 'sonner';
import { computePaymentTermsLabel } from '@/lib/utils';

const PAYMENT_TERM_PRESETS = [
  { label: 'Immediate / COD',           basis: 'invoice_date',              days: 0,  cutoffDay: null },
  { label: '7 days from invoice',       basis: 'invoice_date',              days: 7,  cutoffDay: null },
  { label: '14 days from invoice',      basis: 'invoice_date',              days: 14, cutoffDay: null },
  { label: '30 days from invoice',      basis: 'invoice_date',              days: 30, cutoffDay: null },
  { label: '7 days EOM',                basis: 'end_of_month_of_invoice',   days: 7,  cutoffDay: null },
  { label: '30 days EOM',               basis: 'end_of_month_of_invoice',   days: 30, cutoffDay: null },
  { label: '20th of following month',   basis: 'specific_day_of_month',     days: 0,  cutoffDay: 20 },
];

const EMPTY_TERMS = { payment_terms_basis: '', payment_terms_days: '', payment_terms_cutoff_day: '' };

export default function CreateSupplierModal({ onCreated, onCancel }) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: '',
    contact_name: '',
    email: '',
    phone: '',
    tax_id: '',
    category: 'other',
    is_production_supplier: false,
    ...EMPTY_TERMS,
  });

  const set = (key, value) => setForm(prev => ({ ...prev, [key]: value }));
  const setField = (key) => (e) => set(key, e.target.value);

  const applyPreset = (preset) => {
    setForm(prev => ({
      ...prev,
      payment_terms_basis: preset.basis,
      payment_terms_days: String(preset.days),
      payment_terms_cutoff_day: preset.cutoffDay != null ? String(preset.cutoffDay) : '',
      payment_terms_label: preset.label,
    }));
  };

  const termsPreview = computePaymentTermsLabel(
    form.payment_terms_basis,
    form.payment_terms_days,
    form.payment_terms_cutoff_day,
  );

  const handleCreate = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      await base44.entities.Supplier.create({
        ...form,
        status: 'active',
        payment_terms_days: form.payment_terms_days ? parseInt(form.payment_terms_days) : null,
        payment_terms_cutoff_day: form.payment_terms_cutoff_day ? parseInt(form.payment_terms_cutoff_day) : null,
        payment_terms_label: termsPreview || null,
      });
      toast.success(`Supplier "${form.name}" created`);
      onCreated();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-card rounded-2xl border border-border w-full max-w-md shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Truck className="w-5 h-5 text-primary" />
            <h3 className="text-lg font-bold">Add Supplier</h3>
          </div>
          <Button variant="ghost" size="icon" onClick={onCancel}>
            <X className="w-5 h-5" />
          </Button>
        </div>

        <div className="px-6 py-4 space-y-4">
          {/* Name */}
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase">Supplier Name *</label>
            <Input value={form.name} onChange={setField('name')} placeholder="e.g. Fresh Meats PE" className="mt-1" autoFocus />
          </div>

          {/* Contact */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase">Contact Name</label>
              <Input value={form.contact_name} onChange={setField('contact_name')} placeholder="John Smith" className="mt-1" />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase">Phone</label>
              <Input value={form.phone} onChange={setField('phone')} placeholder="+27 41 123 4567" className="mt-1" />
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase">Email</label>
            <Input value={form.email} onChange={setField('email')} type="email" placeholder="supplier@example.com" className="mt-1" />
          </div>

          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase">VAT Number</label>
            <Input value={form.tax_id} onChange={setField('tax_id')} placeholder="4123456789" className="mt-1" />
          </div>

          {/* Category */}
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase">Category</label>
            <Select value={form.category} onValueChange={v => set('category', v)}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="food">Food — raw ingredients (meat, veg, dairy)</SelectItem>
                <SelectItem value="packaging">Packaging — containers, labels, film</SelectItem>
                <SelectItem value="other">Other — services, software, cleaning</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Production supplier toggle */}
          <div className="flex items-start gap-3 p-3 bg-muted/40 rounded-lg border border-border">
            <Switch
              id="is_production_supplier"
              checked={form.is_production_supplier}
              onCheckedChange={v => set('is_production_supplier', v)}
              className="mt-0.5"
            />
            <div>
              <Label htmlFor="is_production_supplier" className="text-sm font-medium cursor-pointer">
                Production Supplier
              </Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                This supplier is involved in production purchasing (raw materials, packaging, ingredients).
                Only production suppliers appear in the Purchasing Units dropdown on products.
              </p>
            </div>
          </div>

          {/* Payment terms — structured */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-muted-foreground uppercase">Payment Terms</label>
            <div className="flex flex-wrap gap-1.5">
              {PAYMENT_TERM_PRESETS.map(p => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => applyPreset(p)}
                  className={`text-xs px-2 py-1 rounded border transition-colors ${
                    form.payment_terms_basis === p.basis &&
                    String(form.payment_terms_days) === String(p.days) &&
                    String(form.payment_terms_cutoff_day || '') === String(p.cutoffDay || '')
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-background text-foreground border-border hover:border-primary/50'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            {termsPreview && (
              <p className="text-xs text-muted-foreground italic">Payment due: {termsPreview}</p>
            )}
          </div>
        </div>

        <div className="px-6 py-4 border-t border-border flex gap-3">
          <Button variant="outline" className="flex-1" onClick={onCancel}>Cancel</Button>
          <Button className="flex-1 gap-2" onClick={handleCreate} disabled={saving || !form.name.trim()}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Truck className="w-4 h-4" />}
            {saving ? 'Creating...' : 'Create Supplier'}
          </Button>
        </div>
      </div>
    </div>
  );
}
