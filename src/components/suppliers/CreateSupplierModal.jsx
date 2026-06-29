import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { X, Loader2, Truck, CheckCircle2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { formatPaymentTerms } from '@/lib/utils';
import { SupplierContactsSection } from '@/components/suppliers/SupplierContactsSection';

// ---------------------------------------------------------------------------
// Levenshtein similarity — 1.0 = identical, 0 = completely different
// ---------------------------------------------------------------------------
function levenshteinSimilarity(a, b) {
  const s1 = a.toLowerCase().trim(), s2 = b.toLowerCase().trim();
  if (s1 === s2) return 1;
  const m = s1.length, n = s2.length;
  if (!m || !n) return 0;
  const dp = Array.from({ length: m + 1 }, (_, i) => Array.from({ length: n + 1 }, (_, j) => j ? 0 : i));
  for (let j = 1; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = s1[i - 1] === s2[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
  return 1 - dp[m][n] / Math.max(m, n);
}

// ---------------------------------------------------------------------------
// Payment term type options (mirrors SupplierDetailDrawer)
// ---------------------------------------------------------------------------
const PAYMENT_TERM_TYPE_OPTIONS = [
  { value: 'immediate',              label: 'Immediate / COD' },
  { value: 'days_after_invoice',     label: 'Days after invoice date' },
  { value: 'day_of_invoice_month',   label: 'Day of invoice month' },
  { value: 'day_of_following_month', label: 'Day of month following invoice' },
];

function SectionHeading({ children }) {
  return (
    <h4 className="text-xs font-semibold uppercase text-muted-foreground tracking-wide pt-1 pb-0.5 border-b border-border/60">
      {children}
    </h4>
  );
}

const INITIAL_FORM = {
  name: '',
  category: 'other',
  is_production_supplier: false,
  payment_term_type: '',
  payment_term_value: '',
  default_tax_rate_id: '',
  physical_address: '',
  billing_address: '',
  shipping_address: '',
};

export default function CreateSupplierModal({ onCreated, onCancel }) {
  const [form, setForm] = useState(INITIAL_FORM);
  const [vatStatus, setVatStatus] = useState(null); // null | 'registered' | 'not_registered'
  const [vatNumber, setVatNumber] = useState('');
  const [contacts, setContacts] = useState([]);

  // Duplicate detection state
  const [dupWarning, setDupWarning] = useState(null); // null | { type: 'block' | 'warn', match: string }
  const [dupAcknowledged, setDupAcknowledged] = useState(false);

  // Save state
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saved, setSaved] = useState(false);
  const [savedSupplier, setSavedSupplier] = useState(null);

  const set = (key, value) => setForm(prev => ({ ...prev, [key]: value }));

  // Tax rates
  const { data: taxRates = [] } = useQuery({
    queryKey: ['tax-rates'],
    queryFn: () => base44.entities.TaxRate.filter({ active: true }, 'name', 20),
    staleTime: 300000,
  });

  // Payment terms preview
  const termsPreview = form.payment_term_type
    ? formatPaymentTerms(form.payment_term_type, form.payment_term_value)
    : '';

  const handleTermTypeChange = (newType) => {
    setForm(prev => ({
      ...prev,
      payment_term_type: newType,
      payment_term_value: newType === 'immediate' ? '' : prev.payment_term_value,
    }));
  };

  // Duplicate name check on blur
  const handleNameBlur = async () => {
    const name = form.name.trim();
    setDupWarning(null);
    setDupAcknowledged(false);
    if (!name) return;
    try {
      const all = await base44.entities.Supplier.list();
      const names = (all || []).map(s => s.name || '');
      for (const existing of names) {
        const sim = levenshteinSimilarity(name, existing);
        if (sim === 1) {
          setDupWarning({ type: 'block', match: existing });
          return;
        }
        if (sim > 0.75) {
          setDupWarning({ type: 'warn', match: existing });
          return;
        }
      }
    } catch {
      // silently ignore — don't block UX on a network error
    }
  };

  // Validation
  const canSave = () => {
    if (!form.name.trim()) return false;
    if (dupWarning?.type === 'block') return false;
    if (dupWarning?.type === 'warn' && !dupAcknowledged) return false;
    if (vatStatus === null) return false;
    if (vatStatus === 'registered' && !vatNumber.trim()) return false;
    return true;
  };

  const handleCreate = async () => {
    if (!canSave()) return;
    setSaving(true);
    setSaveError('');
    try {
      const payload = {
        ...form,
        is_vat_registered: vatStatus === 'registered',
        vat_number: vatStatus === 'registered' ? vatNumber.trim() : null,
        payment_term_type: form.payment_term_type || null,
        payment_term_value: form.payment_term_value ? parseInt(form.payment_term_value) : null,
        default_tax_rate_id: form.default_tax_rate_id || null,
        physical_address: form.physical_address || null,
        billing_address: form.billing_address || null,
        shipping_address: form.shipping_address || null,
        // Production status is coupled to active/archived — a new supplier is
        // only active if it's flagged as a production supplier.
        status: form.is_production_supplier ? 'active' : 'inactive',
      };

      const newSupplier = await base44.entities.Supplier.create(payload);

      // Create contacts
      for (const contact of contacts) {
        const { _key, ...rest } = contact;
        await base44.entities.SupplierContact.create({
          supplier_id: newSupplier.id,
          ...rest,
        });
      }

      setSavedSupplier(newSupplier);
      setSaved(true);
    } catch (err) {
      const msg = err.message || 'Unknown error';
      setSaveError(msg);
      toast.error(`Failed to create supplier: ${msg}`);
    } finally {
      setSaving(false);
    }
  };

  const handleAddAnother = () => {
    setForm(INITIAL_FORM);
    setVatStatus(null);
    setVatNumber('');
    setContacts([]);
    setDupWarning(null);
    setDupAcknowledged(false);
    setSaved(false);
    setSavedSupplier(null);
    setSaveError('');
  };

  return (
    <div className="max-w-7xl space-y-4">
        {/* Header */}
        <div className="bg-card border border-border rounded-xl px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Truck className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-bold">Add Supplier</h2>
          </div>
          <Button variant="ghost" size="icon" onClick={onCancel} title="Close">
            <X className="w-5 h-5" />
          </Button>
        </div>

        {/* Body */}
        <div className="bg-card border border-border rounded-xl px-6 py-5 grid grid-cols-1 lg:grid-cols-2 gap-x-8 gap-y-5">

          {/* ╓── LEFT COLUMN ──╖ */}
          <div className="space-y-5">

          {/* ── Supplier Name ── */}
          <div className="space-y-1">
            <SectionHeading>Supplier Name</SectionHeading>
            <Input
              value={form.name}
              onChange={e => {
                set('name', e.target.value);
                setDupWarning(null);
                setDupAcknowledged(false);
              }}
              onBlur={handleNameBlur}
              placeholder="e.g. Fresh Meats PE"
              autoFocus
              className={dupWarning?.type === 'block' ? 'border-destructive' : ''}
            />
            {dupWarning?.type === 'block' && (
              <div className="flex items-center gap-1.5 text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1.5">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                A supplier named <strong className="mx-0.5">"{dupWarning.match}"</strong> already exists. Please use a different name.
              </div>
            )}
            {dupWarning?.type === 'warn' && !dupAcknowledged && (
              <div className="flex items-start gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>
                  A similar supplier <strong className="mx-0.5">"{dupWarning.match}"</strong> already exists. Is this a duplicate?{' '}
                  <button
                    type="button"
                    className="underline font-semibold ml-1"
                    onClick={() => setDupAcknowledged(true)}
                  >
                    Continue anyway
                  </button>
                </span>
              </div>
            )}
          </div>

          {/* ── Category + Production Supplier ── */}
          <div className="space-y-3">
            <SectionHeading>Classification</SectionHeading>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase block mb-1">Category</label>
                <Select value={form.category} onValueChange={v => set('category', v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="food">Food — raw ingredients (meat, veg, dairy)</SelectItem>
                    <SelectItem value="packaging">Packaging — containers, labels, film</SelectItem>
                    <SelectItem value="resale">Resale — supplements, finished goods</SelectItem>
                    <SelectItem value="other">Other — services, software, cleaning</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end pb-0.5">
                <div className="flex items-start gap-3 p-3 bg-muted/40 rounded-lg border border-border w-full">
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
                      Appears in the Purchasing Units dropdown on products.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ── VAT Registration ── */}
          <div className="space-y-2">
            <SectionHeading>VAT Registration</SectionHeading>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setVatStatus('registered')}
                className={`flex-1 py-2.5 text-sm font-medium rounded-lg border transition-colors ${
                  vatStatus === 'registered'
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-background text-foreground border-border hover:border-primary/60'
                }`}
              >
                VAT Registered
              </button>
              <button
                type="button"
                onClick={() => setVatStatus('not_registered')}
                className={`flex-1 py-2.5 text-sm font-medium rounded-lg border transition-colors ${
                  vatStatus === 'not_registered'
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-background text-foreground border-border hover:border-primary/60'
                }`}
              >
                Not VAT Registered
              </button>
            </div>
            {vatStatus === null && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                VAT registration status is required.
              </p>
            )}
            {vatStatus === 'registered' && (
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase block mb-1">VAT Number *</label>
                <Input
                  value={vatNumber}
                  onChange={e => setVatNumber(e.target.value)}
                  placeholder="e.g. 4123456789"
                />
              </div>
            )}
          </div>

          {/* ── Payment Terms ── */}
          <div className="space-y-2">
            <SectionHeading>Payment Terms</SectionHeading>
            <div className="flex gap-2 items-center flex-wrap">
              {form.payment_term_type !== 'immediate' && (
                <Input
                  type="number"
                  min={1}
                  max={form.payment_term_type === 'days_after_invoice' ? 365 : 31}
                  placeholder={form.payment_term_type === 'days_after_invoice' ? 'Days' : 'Day'}
                  value={form.payment_term_value}
                  onChange={e => set('payment_term_value', e.target.value)}
                  className="w-20 h-9"
                />
              )}
              <Select value={form.payment_term_type || ''} onValueChange={handleTermTypeChange}>
                <SelectTrigger className="flex-1 min-w-[200px] h-9">
                  <SelectValue placeholder="Select payment term type…" />
                </SelectTrigger>
                <SelectContent>
                  {PAYMENT_TERM_TYPE_OPTIONS.map(o => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {termsPreview && (
              <p className="text-xs text-muted-foreground italic">→ {termsPreview}</p>
            )}
          </div>

          {/* ── Default Tax Rate ── */}
          <div className="space-y-2">
            <SectionHeading>Default Tax Rule</SectionHeading>
            <Select
              value={form.default_tax_rate_id || '_none'}
              onValueChange={v => set('default_tax_rate_id', v === '_none' ? '' : v)}
            >
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Use system default" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_none">Use system default</SelectItem>
                {taxRates.map(r => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.name} ({(r.rate * 100).toFixed(0)}%)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          </div>
          {/* ╙── END LEFT COLUMN ──╜ */}

          {/* ╓── RIGHT COLUMN ──╖ */}
          <div className="space-y-5">

          {/* ── Addresses ── */}
          <div className="space-y-3">
            <SectionHeading>Addresses</SectionHeading>
            <div className="grid grid-cols-1 gap-3">
              {[
                { key: 'physical_address', label: 'Physical Address' },
                { key: 'billing_address',  label: 'Billing Address' },
                { key: 'shipping_address', label: 'Shipping Address' },
              ].map(({ key, label }) => (
                <div key={key}>
                  <label className="text-xs font-semibold text-muted-foreground uppercase block mb-1">{label}</label>
                  <Textarea
                    value={form[key]}
                    onChange={e => set(key, e.target.value)}
                    placeholder={label}
                    className="text-sm h-20 resize-none"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* ── Contacts ── */}
          <div className="space-y-3">
            <SectionHeading>Contacts</SectionHeading>
            <SupplierContactsSection contacts={contacts} onChange={setContacts} />
          </div>

          </div>
          {/* ╙── END RIGHT COLUMN ──╜ */}
        </div>

        {/* Footer */}
        <div className="bg-card border border-border rounded-xl px-6 py-4 space-y-2">
          {saveError && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1.5">
              {saveError}
            </p>
          )}

          {saved ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span><strong>{savedSupplier?.name}</strong> was created successfully.</span>
              </div>
              <div className="flex gap-3">
                <Button variant="outline" className="flex-1" onClick={handleAddAnother}>
                  Add Another
                </Button>
                <Button className="flex-1" onClick={() => onCreated(savedSupplier)}>
                  Close
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={onCancel}>Cancel</Button>
              <Button
                className="flex-1 gap-2"
                onClick={handleCreate}
                disabled={saving || !canSave()}
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Truck className="w-4 h-4" />}
                {saving ? 'Creating…' : 'Create Supplier'}
              </Button>
            </div>
          )}
        </div>
    </div>
  );
}
