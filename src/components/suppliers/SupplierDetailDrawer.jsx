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
import { X, Truck, User, Mail, Phone, CreditCard, MapPin, Save, Loader2, Pencil, FileText, Tag, Factory } from 'lucide-react';
import { toast } from 'sonner';
import { Link } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { getUserPermissions } from '@/lib/permissions';
import { useCustomRoles } from '@/components/settings/CustomRolesManager';
import SupplierProductsTab from '@/components/purchasing/SupplierProductsTab';
import { computePaymentTermsLabel, formatZAR } from '@/lib/utils';

const PAYMENT_TERM_PRESETS = [
  { label: 'Immediate / COD',         basis: 'invoice_date',            days: 0,  cutoffDay: null },
  { label: '7 days from invoice',     basis: 'invoice_date',            days: 7,  cutoffDay: null },
  { label: '14 days from invoice',    basis: 'invoice_date',            days: 14, cutoffDay: null },
  { label: '30 days from invoice',    basis: 'invoice_date',            days: 30, cutoffDay: null },
  { label: '7 days EOM',              basis: 'end_of_month_of_invoice', days: 7,  cutoffDay: null },
  { label: '30 days EOM',             basis: 'end_of_month_of_invoice', days: 30, cutoffDay: null },
  { label: '20th of following month', basis: 'specific_day_of_month',   days: 0,  cutoffDay: 20 },
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
  const [form, setForm] = useState({
    name: supplier.name || '',
    contact_name: supplier.contact_name || '',
    email: supplier.email || '',
    phone: supplier.phone || '',
    billing_address: supplier.billing_address || '',
    shipping_address: supplier.shipping_address || '',
    tax_id: supplier.tax_id || '',
    category: supplier.category || 'other',
    is_production_supplier: supplier.is_production_supplier || false,
    payment_terms_basis: supplier.payment_terms_basis || '',
    payment_terms_days: supplier.payment_terms_days != null ? String(supplier.payment_terms_days) : '',
    payment_terms_cutoff_day: supplier.payment_terms_cutoff_day != null ? String(supplier.payment_terms_cutoff_day) : '',
  });

  const setField = (key) => (value) => setForm(prev => ({ ...prev, [key]: value }));

  const applyTermsPreset = (p) => setForm(prev => ({
    ...prev,
    payment_terms_basis: p.basis,
    payment_terms_days: String(p.days),
    payment_terms_cutoff_day: p.cutoffDay != null ? String(p.cutoffDay) : '',
  }));

  const termsPreview = computePaymentTermsLabel(
    form.payment_terms_basis, form.payment_terms_days, form.payment_terms_cutoff_day
  );
  const supplierTermsDisplay = supplier.payment_terms_label ||
    computePaymentTermsLabel(supplier.payment_terms_basis, supplier.payment_terms_days, supplier.payment_terms_cutoff_day) ||
    supplier.payment_terms || '—';

  // Fetch POs for this supplier
  const { data: supplierPOs = [] } = useQuery({
    queryKey: ['supplier-pos', supplier.id],
    queryFn: () => base44.entities.PurchaseOrder.filter({ supplier_id: supplier.id }, '-created_date', 50),
  });

  const openPOs = useMemo(() => supplierPOs.filter(po => !['received', 'cancelled', 'paid'].includes(po.status)), [supplierPOs]);
  const outstandingTotal = useMemo(() => openPOs.reduce((sum, po) => sum + (po.total || 0), 0), [openPOs]);

  const handleSave = async () => {
    setSaving(true);
    await base44.entities.Supplier.update(supplier.id, {
      ...form,
      payment_terms_days: form.payment_terms_days ? parseInt(form.payment_terms_days) : null,
      payment_terms_cutoff_day: form.payment_terms_cutoff_day ? parseInt(form.payment_terms_cutoff_day) : null,
      payment_terms_label: termsPreview || null,
    });
    onUpdated?.();
    toast.success('Supplier updated');
    setSaving(false);
    setEditing(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-card shadow-xl flex flex-col">
        {/* Header */}
        <div className="sticky top-0 bg-card border-b border-border px-6 py-4 flex items-start justify-between z-10 shrink-0">
          <div>
            <Badge className={`text-[10px] mb-1 ${supplier.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
              {supplier.status || 'active'}
            </Badge>
            <h2 className="text-lg font-bold flex items-center gap-2">
              <Truck className="w-5 h-5 text-primary" />
              {editing ? form.name : supplier.name}
            </h2>
          </div>
          <div className="flex items-center gap-1">
            {!editing && (
              <Button variant="ghost" size="icon" onClick={() => setEditing(true)} title="Edit supplier">
                <Pencil className="w-4 h-4" />
              </Button>
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
                <EditField icon={CreditCard} label="VAT Number" value={form.tax_id} onChange={setField('tax_id')} />
                <div className="flex items-start gap-3">
                  <Tag className="w-4 h-4 text-muted-foreground mt-2.5 shrink-0" />
                  <div className="flex-1">
                    <label className="text-[10px] uppercase text-muted-foreground font-semibold block mb-1">Category</label>
                    <Select value={form.category || 'other'} onValueChange={v => setField('category')(v)}>
                      <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="food">Food — raw ingredients</SelectItem>
                        <SelectItem value="packaging">Packaging — containers, labels</SelectItem>
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
                {/* Structured payment terms */}
                <div className="flex items-start gap-3">
                  <CreditCard className="w-4 h-4 text-muted-foreground mt-2.5 shrink-0" />
                  <div className="flex-1 space-y-2">
                    <label className="text-[10px] uppercase text-muted-foreground font-semibold block">Payment Terms</label>
                    <div className="flex flex-wrap gap-1">
                      {PAYMENT_TERM_PRESETS.map(p => (
                        <button key={p.label} type="button" onClick={() => applyTermsPreset(p)}
                          className={`text-xs px-2 py-0.5 rounded border transition-colors ${
                            form.payment_terms_basis === p.basis &&
                            String(form.payment_terms_days) === String(p.days) &&
                            String(form.payment_terms_cutoff_day || '') === String(p.cutoffDay || '')
                              ? 'bg-primary text-primary-foreground border-primary'
                              : 'bg-background border-border hover:border-primary/50'
                          }`}>
                          {p.label}
                        </button>
                      ))}
                    </div>
                    {termsPreview && (
                      <p className="text-xs text-muted-foreground italic">→ {termsPreview}</p>
                    )}
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
              </div>
            ) : (
              <div className="space-y-3">
                <ReadOnlyField icon={User} label="Contact Name" value={supplier.contact_name} />
                <ReadOnlyField icon={Mail} label="Email" value={supplier.email} />
                <ReadOnlyField icon={Phone} label="Phone" value={supplier.phone} />
                <ReadOnlyField icon={CreditCard} label="Payment Terms" value={supplierTermsDisplay} />
                <ReadOnlyField icon={MapPin} label="Billing Address" value={supplier.billing_address} />
                <ReadOnlyField icon={MapPin} label="Shipping Address" value={supplier.shipping_address} />
                {supplier.tax_id && <ReadOnlyField icon={CreditCard} label="VAT Number" value={supplier.tax_id} />}
                <ReadOnlyField icon={Tag} label="Category" value={supplier.category ? supplier.category.charAt(0).toUpperCase() + supplier.category.slice(1) : 'Other'} />
                {supplier.is_production_supplier && (
                  <div className="flex items-center gap-2">
                    <Factory className="w-4 h-4 text-green-600" />
                    <span className="text-sm text-green-700 font-medium">Production Supplier</span>
                  </div>
                )}
                {!supplier.contact_name && !supplier.email && !supplier.phone && (
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

          {supplier.cin7_id && (
            <div className="pt-2 border-t border-border">
              <p className="text-[10px] text-muted-foreground">Cin7 ID: <span className="font-mono">{supplier.cin7_id}</span></p>
            </div>
          )}
        </div>

        {/* Footer — save when editing */}
        {editing && (
          <div className="sticky bottom-0 bg-card border-t border-border px-6 py-3 shrink-0 flex gap-3">
            <Button variant="outline" className="flex-1" onClick={() => setEditing(false)}>Cancel</Button>
            <Button className="flex-1 gap-2" onClick={handleSave} disabled={saving || !form.name.trim()}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {saving ? 'Saving...' : 'Save'}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}