import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { X, Truck, User, Mail, Phone, CreditCard, MapPin, Save, Loader2, Pencil, FileText, Tag, Factory, AlertTriangle, Percent, GitMerge, Users, Star, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { Link } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { getUserPermissions } from '@/lib/permissions';
import { useCustomRoles } from '@/components/settings/CustomRolesManager';
import SupplierProductsTab from '@/components/purchasing/SupplierProductsTab';
import SupplierMergeModal from '@/components/suppliers/SupplierMergeModal';
import { SupplierContactsSection } from '@/components/suppliers/SupplierContactsSection';
import { computePaymentTermsLabel, formatPaymentTerms, formatZAR } from '@/lib/utils';

const PAYMENT_TERM_TYPE_OPTIONS = [
  { value: 'immediate',              label: 'Immediate' },
  { value: 'days_after_invoice',     label: 'Days after invoice date' },
  { value: 'day_of_invoice_month',   label: 'Day of invoice month' },
  { value: 'day_of_following_month', label: 'Day of month following invoice' },
];

function ReadOnlyField({ icon: Icon, label, value }) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-3">
      <Icon className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
      <div>
        <p className="text-[10px] uppercase text-muted-foreground font-semibold">{label}</p>
        <p className="text-sm">{value}</p>
      </div>
    </div>
  );
}

function EditField({ icon: Icon, label, value, onChange, type = 'text', placeholder }) {
  return (
    <div className="flex items-start gap-3">
      <Icon className="w-4 h-4 text-muted-foreground mt-2.5 shrink-0" />
      <div className="flex-1">
        <label className="text-[10px] uppercase text-muted-foreground font-semibold block mb-1">{label}</label>
        <Input
          type={type}
          value={value || ''}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder || label}
          className="h-8 text-sm"
        />
      </div>
    </div>
  );
}

export default function SupplierDetailDrawer({ supplier, onClose, onUpdated }) {
  const { user } = useAuth();
  const customRoles = useCustomRoles();
  const perms = getUserPermissions(user || {}, customRoles);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [showMerge, setShowMerge] = useState(false);
  const [liveSupplier, setLiveSupplier] = useState(supplier);
  const [form, setForm] = useState({
    name: supplier.name || '',
    contact_name: supplier.contact_name || '',
    email: supplier.email || '',
    phone: supplier.phone || '',
    billing_address: supplier.billing_address || '',
    shipping_address: supplier.shipping_address || '',
    physical_address: supplier.physical_address || '',
    tax_id: supplier.tax_id || '',
    category: supplier.category || 'other',
    is_production_supplier: supplier.is_production_supplier || false,
    is_vat_registered: supplier.is_vat_registered || false,
    vat_number: supplier.vat_number || '',
    // New structured payment terms (v2)
    payment_term_type: supplier.payment_term_type || '',
    payment_term_value: supplier.payment_term_value != null ? String(supplier.payment_term_value) : '',
    // Legacy fields kept for backward compatibility
    payment_terms_basis: supplier.payment_terms_basis || '',
    payment_terms_days: supplier.payment_terms_days != null ? String(supplier.payment_terms_days) : '',
    payment_terms_cutoff_day: supplier.payment_terms_cutoff_day != null ? String(supplier.payment_terms_cutoff_day) : '',
    // Tax rate
    default_tax_rate_id: supplier.default_tax_rate_id || '',
  });
  // Contacts edit state — populated when editing starts
  const [contactsEdit, setContactsEdit] = useState([]);

  const setField = (key) => (value) => setForm(prev => ({ ...prev, [key]: value }));

  // When payment_term_type changes, clear the value if switching to immediate
  const handleTermTypeChange = (newType) => {
    setForm(prev => ({
      ...prev,
      payment_term_type: newType,
      payment_term_value: newType === 'immediate' ? '' : prev.payment_term_value,
    }));
  };

  // Derive legacy fields from new term type for backward compat on save
  const deriveLegacyTerms = (type, value) => {
    const v = parseInt(value) || 0;
    switch (type) {
      case 'immediate':              return { basis: 'invoice_date', days: 0, cutoff: null };
      case 'days_after_invoice':     return { basis: 'invoice_date', days: v, cutoff: null };
      case 'day_of_invoice_month':   return { basis: 'end_of_month_of_invoice', days: 0, cutoff: v };
      case 'day_of_following_month': return { basis: 'specific_day_of_month', days: 0, cutoff: v };
      default:                       return { basis: '', days: null, cutoff: null };
    }
  };

  const termsPreviewNew = form.payment_term_type
    ? formatPaymentTerms(form.payment_term_type, form.payment_term_value)
    : computePaymentTermsLabel(form.payment_terms_basis, form.payment_terms_days, form.payment_terms_cutoff_day);

  const supplierTermsDisplay = liveSupplier.payment_term_type
    ? formatPaymentTerms(liveSupplier.payment_term_type, liveSupplier.payment_term_value)
    : (liveSupplier.payment_terms_label ||
        computePaymentTermsLabel(liveSupplier.payment_terms_basis, liveSupplier.payment_terms_days, liveSupplier.payment_terms_cutoff_day) ||
        liveSupplier.payment_terms || '—');

  // Tax rates for dropdown
  const { data: taxRates = [] } = useQuery({
    queryKey: ['tax-rates'],
    queryFn: () => base44.entities.TaxRate.filter({ active: true }, 'name', 20),
    staleTime: 300000,
  });

  // Contacts for this supplier
  const { data: contacts = [], refetch: refetchContacts } = useQuery({
    queryKey: ['supplier-contacts', supplier.id],
    queryFn: () => base44.entities.SupplierContact.filter({ supplier_id: supplier.id }),
    staleTime: 60000,
  });

  // Fetch POs for this supplier
  const { data: supplierPOs = [] } = useQuery({
    queryKey: ['supplier-pos', supplier.id],
    queryFn: () => base44.entities.PurchaseOrder.filter({ supplier_id: supplier.id }, '-created_date', 50),
  });

  const openPOs = useMemo(() => supplierPOs.filter(po => !['received', 'cancelled', 'paid'].includes(po.status)), [supplierPOs]);
  const outstandingTotal = useMemo(() => openPOs.reduce((sum, po) => sum + (po.total || 0), 0), [openPOs]);

  const handleSave = async () => {
    setSaving(true);
    setSaveError('');
    try {
      const legacy = deriveLegacyTerms(form.payment_term_type, form.payment_term_value);
      const updated = await base44.entities.Supplier.update(supplier.id, {
        ...form,
        payment_term_type: form.payment_term_type || null,
        payment_term_value: form.payment_term_value ? parseInt(form.payment_term_value) : null,
        payment_terms_basis: legacy.basis || form.payment_terms_basis || null,
        payment_terms_days: legacy.days ?? (form.payment_terms_days ? parseInt(form.payment_terms_days) : null),
        payment_terms_cutoff_day: legacy.cutoff ?? (form.payment_terms_cutoff_day ? parseInt(form.payment_terms_cutoff_day) : null),
        payment_terms_label: termsPreviewNew || null,
        default_tax_rate_id: form.default_tax_rate_id || null,
        is_vat_registered: form.is_vat_registered,
        vat_number: form.is_vat_registered ? (form.vat_number || null) : null,
        physical_address: form.physical_address || null,
      });

      // Diff contacts: create new (_key only), delete removed, update changed (id present)
      const originalIds = new Set(contacts.map(c => c.id));
      const editIds = new Set(contactsEdit.filter(c => c.id).map(c => c.id));

      // Delete removed
      for (const id of originalIds) {
        if (!editIds.has(id)) {
          await base44.entities.SupplierContact.delete(id);
        }
      }

      for (const contact of contactsEdit) {
        const { _key, ...rest } = contact;
        if (contact.id) {
          // Update existing
          await base44.entities.SupplierContact.update(contact.id, rest);
        } else {
          // Create new
          await base44.entities.SupplierContact.create({ supplier_id: supplier.id, ...rest });
        }
      }

      await refetchContacts();
      setLiveSupplier(updated);
      onUpdated?.(updated);
      toast.success('Supplier updated');
      setEditing(false);
    } catch (err) {
      const msg = err.message || 'Unknown error';
      setSaveError(msg);
      toast.error(`Save failed: ${msg}`);
      console.error('[SupplierDetailDrawer] save failed:', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
    <div className="fixed inset-0 z-50 bg-card flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="bg-card border-b border-border px-6 py-4 flex items-start justify-between shrink-0">
          <div>
            <Badge className={`text-[10px] mb-1 ${liveSupplier.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
              {liveSupplier.status || 'active'}
            </Badge>
            <h2 className="text-lg font-bold flex items-center gap-2">
              <Truck className="w-5 h-5 text-primary" />
              {editing ? form.name : liveSupplier.name}
            </h2>
          </div>
          <div className="flex items-center gap-1">
            {!editing && (
              <>
                <Button variant="ghost" size="icon" onClick={() => { setEditing(true); setContactsEdit(contacts.map(c => ({ ...c }))); }} title="Edit supplier">
                  <Pencil className="w-4 h-4" />
                </Button>
                <Button variant="ghost" size="icon" onClick={() => setShowMerge(true)} title="Merge duplicate supplier">
                  <GitMerge className="w-4 h-4" />
                </Button>
              </>
            )}
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="w-5 h-5" />
            </Button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
          <div className="space-y-3">
            <h3 className="text-sm font-semibold">Contact Details</h3>
            {editing ? (
              <div className="space-y-3">
                <EditField icon={Truck} label="Supplier Name" value={form.name} onChange={setField('name')} />
                <EditField icon={User} label="Contact Name" value={form.contact_name} onChange={setField('contact_name')} placeholder="John Smith" />
                <EditField icon={Mail} label="Email" value={form.email} onChange={setField('email')} type="email" placeholder="supplier@example.com" />
                <EditField icon={Phone} label="Phone" value={form.phone} onChange={setField('phone')} type="tel" placeholder="+27 41 123 4567" />
                <EditField icon={CreditCard} label="Tax ID (legacy)" value={form.tax_id} onChange={setField('tax_id')} />
                {/* VAT Registration */}
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="w-4 h-4 text-muted-foreground mt-2.5 shrink-0" />
                  <div className="flex-1 space-y-2">
                    <label className="text-[10px] uppercase text-muted-foreground font-semibold block">VAT Registration</label>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setField('is_vat_registered')(true)}
                        className={`flex-1 py-1.5 text-xs font-medium rounded border transition-colors ${
                          form.is_vat_registered
                            ? 'bg-primary text-primary-foreground border-primary'
                            : 'bg-background border-border hover:border-primary/50'
                        }`}
                      >
                        VAT Registered
                      </button>
                      <button
                        type="button"
                        onClick={() => setField('is_vat_registered')(false)}
                        className={`flex-1 py-1.5 text-xs font-medium rounded border transition-colors ${
                          !form.is_vat_registered
                            ? 'bg-primary text-primary-foreground border-primary'
                            : 'bg-background border-border hover:border-primary/50'
                        }`}
                      >
                        Not VAT Registered
                      </button>
                    </div>
                    {form.is_vat_registered && (
                      <Input
                        value={form.vat_number}
                        onChange={e => setField('vat_number')(e.target.value)}
                        placeholder="VAT Number"
                        className="h-8 text-sm"
                      />
                    )}
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Tag className="w-4 h-4 text-muted-foreground mt-2.5 shrink-0" />
                  <div className="flex-1">
                    <label className="text-[10px] uppercase text-muted-foreground font-semibold block mb-1">Category</label>
                    <Select value={form.category || 'other'} onValueChange={v => setField('category')(v)}>
                      <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="food">Food — raw ingredients</SelectItem>
                        <SelectItem value="packaging">Packaging — containers, labels</SelectItem>
                        <SelectItem value="resale">Resale — supplements, finished goods</SelectItem>
                        <SelectItem value="other">Other — services, software</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                {/* Production supplier toggle */}
                <div className="flex items-start gap-3 ml-7 p-3 bg-muted/40 rounded-lg border border-border">
                  <Switch
                    id="edit_is_production_supplier"
                    checked={form.is_production_supplier}
                    onCheckedChange={v => setField('is_production_supplier')(v)}
                    className="mt-0.5"
                  />
                  <div>
                    <Label htmlFor="edit_is_production_supplier" className="text-sm font-medium cursor-pointer">
                      Production Supplier
                    </Label>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Appears in the Purchasing Units dropdown on products (raw materials, packaging, ingredients).
                    </p>
                  </div>
                </div>
                {/* Payment terms — Dext-style: [N] [Type dropdown] */}
                <div className="flex items-start gap-3">
                  <CreditCard className="w-4 h-4 text-muted-foreground mt-2.5 shrink-0" />
                  <div className="flex-1 space-y-2">
                    <label className="text-[10px] uppercase text-muted-foreground font-semibold block">Payment Terms</label>
                    <div className="flex gap-2 items-center flex-wrap">
                      {form.payment_term_type !== 'immediate' && (
                        <Input
                          type="number"
                          min={1}
                          max={form.payment_term_type === 'days_after_invoice' ? 365 : 31}
                          placeholder={form.payment_term_type === 'days_after_invoice' ? 'Days' : 'Day'}
                          value={form.payment_term_value}
                          onChange={e => setField('payment_term_value')(e.target.value)}
                          className="h-8 text-sm w-20"
                        />
                      )}
                      <Select value={form.payment_term_type || ''} onValueChange={handleTermTypeChange}>
                        <SelectTrigger className="h-8 text-sm flex-1 min-w-[180px]">
                          <SelectValue placeholder="Select payment term type…" />
                        </SelectTrigger>
                        <SelectContent>
                          {PAYMENT_TERM_TYPE_OPTIONS.map(o => (
                            <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {termsPreviewNew && (
                      <p className="text-xs text-muted-foreground italic">→ {termsPreviewNew}</p>
                    )}
                    {!form.payment_term_type && (
                      <div className="flex items-center gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                        <AlertTriangle className="w-3 h-3 shrink-0" />
                        No payment terms set — due dates won't auto-calculate for this supplier.
                      </div>
                    )}
                  </div>
                </div>
                {/* Default tax rate */}
                <div className="flex items-start gap-3">
                  <Percent className="w-4 h-4 text-muted-foreground mt-2.5 shrink-0" />
                  <div className="flex-1">
                    <label className="text-[10px] uppercase text-muted-foreground font-semibold block mb-1">Default VAT for purchases</label>
                    <Select value={form.default_tax_rate_id || '_none'} onValueChange={v => setField('default_tax_rate_id')(v === '_none' ? '' : v)}>
                      <SelectTrigger className="h-8 text-sm">
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
                <div className="flex items-start gap-3">
                  <MapPin className="w-4 h-4 text-muted-foreground mt-2.5 shrink-0" />
                  <div className="flex-1">
                    <label className="text-[10px] uppercase text-muted-foreground font-semibold block mb-1">Physical Address</label>
                    <Textarea
                      value={form.physical_address}
                      onChange={e => setField('physical_address')(e.target.value)}
                      className="text-sm h-16"
                      placeholder="Physical / street address"
                    />
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <MapPin className="w-4 h-4 text-muted-foreground mt-2.5 shrink-0" />
                  <div className="flex-1">
                    <label className="text-[10px] uppercase text-muted-foreground font-semibold block mb-1">Billing Address</label>
                    <Textarea
                      value={form.billing_address}
                      onChange={e => setField('billing_address')(e.target.value)}
                      className="text-sm h-16"
                      placeholder="Billing address"
                    />
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <MapPin className="w-4 h-4 text-muted-foreground mt-2.5 shrink-0" />
                  <div className="flex-1">
                    <label className="text-[10px] uppercase text-muted-foreground font-semibold block mb-1">Shipping Address</label>
                    <Textarea
                      value={form.shipping_address}
                      onChange={e => setField('shipping_address')(e.target.value)}
                      className="text-sm h-16"
                      placeholder="Shipping address"
                    />
                  </div>
                </div>
                {/* Contacts edit */}
                <div className="flex items-start gap-3">
                  <Users className="w-4 h-4 text-muted-foreground mt-2.5 shrink-0" />
                  <div className="flex-1">
                    <label className="text-[10px] uppercase text-muted-foreground font-semibold block mb-2">Contacts</label>
                    <SupplierContactsSection contacts={contactsEdit} onChange={setContactsEdit} />
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <ReadOnlyField icon={User} label="Contact Name" value={liveSupplier.contact_name} />
                <ReadOnlyField icon={Mail} label="Email" value={liveSupplier.email} />
                <ReadOnlyField icon={Phone} label="Phone" value={liveSupplier.phone} />
                {/* VAT status in read mode */}
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                  <div>
                    <p className="text-[10px] uppercase text-muted-foreground font-semibold">VAT Registration</p>
                    {liveSupplier.is_vat_registered ? (
                      <p className="text-sm text-green-700 font-medium">
                        VAT Registered{liveSupplier.vat_number ? ` — ${liveSupplier.vat_number}` : ''}
                      </p>
                    ) : (
                      <p className="text-sm text-muted-foreground">Not VAT registered</p>
                    )}
                  </div>
                </div>
                <ReadOnlyField icon={CreditCard} label="Payment Terms" value={supplierTermsDisplay} />
                {!liveSupplier.payment_term_type && (
                  <div className="flex items-center gap-2 ml-7 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                    <AlertTriangle className="w-3 h-3 shrink-0" />
                    No payment terms configured. Due dates won't auto-calculate.
                  </div>
                )}
                <ReadOnlyField icon={MapPin} label="Physical Address" value={liveSupplier.physical_address} />
                <ReadOnlyField icon={MapPin} label="Billing Address" value={liveSupplier.billing_address} />
                <ReadOnlyField icon={MapPin} label="Shipping Address" value={liveSupplier.shipping_address} />
                {liveSupplier.tax_id && <ReadOnlyField icon={CreditCard} label="Tax ID (legacy)" value={liveSupplier.tax_id} />}
                <ReadOnlyField icon={Tag} label="Category" value={
                  liveSupplier.category === 'food' ? 'Food' :
                  liveSupplier.category === 'packaging' ? 'Packaging' :
                  liveSupplier.category === 'resale' ? 'Resale' : 'Other'
                } />
                {liveSupplier.is_production_supplier && (
                  <div className="flex items-center gap-2">
                    <Factory className="w-4 h-4 text-green-600" />
                    <span className="text-sm text-green-700 font-medium">Production Supplier</span>
                  </div>
                )}
                {/* Contacts read mode */}
                {contacts.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-1.5">
                      <Users className="w-4 h-4 text-muted-foreground" />
                      <p className="text-[10px] uppercase text-muted-foreground font-semibold">Contacts</p>
                    </div>
                    <div className="ml-6 space-y-2">
                      {contacts.map(c => (
                        <div key={c.id} className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm space-y-0.5">
                          <div className="flex items-center gap-1.5 font-medium">
                            {c.is_primary && <Star className="w-3 h-3 text-amber-500 fill-amber-500" />}
                            {c.name || <span className="text-muted-foreground italic">Unnamed</span>}
                            {c.role && c.role !== 'general' && (
                              <span className="text-[10px] text-muted-foreground capitalize ml-1">({c.role})</span>
                            )}
                          </div>
                          {c.email && <p className="text-xs text-muted-foreground">{c.email}</p>}
                          {c.phone && <p className="text-xs text-muted-foreground">{c.phone}</p>}
                          {c.notes && <p className="text-xs text-muted-foreground italic">{c.notes}</p>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {!liveSupplier.contact_name && !liveSupplier.email && !liveSupplier.phone && contacts.length === 0 && (
                  <p className="text-xs text-muted-foreground italic">No contact details on file — click the pencil to add them</p>
                )}
              </div>
            )}
          </div>

          {/* Open Purchase Orders */}
          <div>
            <h3 className="text-sm font-semibold flex items-center gap-2 mb-3">
              <FileText className="w-4 h-4 text-primary" />
              Purchase Orders ({supplierPOs.length})
              {outstandingTotal > 0 && (
                <Badge className="text-[10px] bg-amber-100 text-amber-700 ml-auto">
                  R {outstandingTotal.toLocaleString('en-ZA', { minimumFractionDigits: 2 })} outstanding
                </Badge>
              )}
            </h3>
            {openPOs.length === 0 && supplierPOs.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">No purchase orders yet</p>
            ) : (
              <div className="bg-card border border-border rounded-lg overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="bg-muted/50 border-b border-border">
                      <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">PO #</th>
                      <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Date</th>
                      <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Total</th>
                      <th className="text-center px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {supplierPOs.slice(0, 10).map(po => {
                      const statusColors = {
                        draft: 'bg-gray-100 text-gray-600',
                        confirmed: 'bg-blue-100 text-blue-700',
                        partially_received: 'bg-amber-100 text-amber-700',
                        received: 'bg-green-100 text-green-700',
                        invoiced: 'bg-purple-100 text-purple-700',
                        paid: 'bg-green-100 text-green-700',
                        cancelled: 'bg-red-100 text-red-600',
                      };
                      return (
                        <tr key={po.id} className="hover:bg-muted/20">
                          <td className="px-3 py-2 text-xs font-mono font-medium">{po.po_number}</td>
                          <td className="px-3 py-2 text-xs text-muted-foreground">{po.order_date || '—'}</td>
                          <td className="px-3 py-2 text-xs text-right font-medium">R {(po.total || 0).toLocaleString('en-ZA', { minimumFractionDigits: 2 })}</td>
                          <td className="px-3 py-2 text-center">
                            <Badge className={`text-[10px] ${statusColors[po.status] || 'bg-gray-100 text-gray-600'}`}>
                              {(po.status || 'draft').replace('_', ' ')}
                            </Badge>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {supplierPOs.length > 10 && (
                  <div className="px-3 py-2 bg-muted/30 border-t border-border">
                    <p className="text-xs text-muted-foreground">+{supplierPOs.length - 10} more orders</p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Supplier Product Catalog (new SupplierProduct entity) */}
          <SupplierProductsTab supplierId={supplier.id} canEdit={perms.supplier_product_edit} />

          {liveSupplier.cin7_id && (
            <div className="pt-2 border-t border-border">
              <p className="text-[10px] text-muted-foreground">Cin7 ID: <span className="font-mono">{liveSupplier.cin7_id}</span></p>
            </div>
          )}
        </div>

        {/* Footer — save when editing */}
        {editing && (
          <div className="bg-card border-t border-border px-6 py-3 shrink-0 space-y-2">
            {saveError && (
              <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1">
                Save failed: {saveError}
              </p>
            )}
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => { setEditing(false); setSaveError(''); setContactsEdit([]); }}>Cancel</Button>
              <Button className="flex-1 gap-2" onClick={handleSave} disabled={saving || !form.name.trim()}>
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                {saving ? 'Saving...' : 'Save'}
              </Button>
            </div>
          </div>
        )}
    </div>

    {showMerge && (
      <SupplierMergeModal
        supplier={liveSupplier}
        onClose={() => setShowMerge(false)}
        onMerged={(primaryId) => {
          setShowMerge(false);
          if (primaryId !== liveSupplier.id) onClose();
          else onUpdated?.(liveSupplier);
        }}
      />
    )}
    </>
  );
}