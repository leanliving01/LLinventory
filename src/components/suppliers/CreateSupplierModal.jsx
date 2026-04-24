import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { X, Loader2, Truck } from 'lucide-react';
import { toast } from 'sonner';

export default function CreateSupplierModal({ onCreated, onCancel }) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: '',
    contact_name: '',
    email: '',
    phone: '',
    payment_terms: '',
    tax_id: '',
  });

  const setField = (key) => (e) => setForm(prev => ({ ...prev, [key]: e.target.value }));

  const handleCreate = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    await base44.entities.Supplier.create({ ...form, status: 'active' });
    toast.success(`Supplier "${form.name}" created`);
    setSaving(false);
    onCreated();
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-card rounded-2xl border border-border w-full max-w-md shadow-xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Truck className="w-5 h-5 text-primary" />
            <h3 className="text-lg font-bold">Add Supplier</h3>
          </div>
          <Button variant="ghost" size="icon" onClick={onCancel}>
            <X className="w-5 h-5" />
          </Button>
        </div>

        <div className="px-6 py-4 space-y-3">
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase">Supplier Name *</label>
            <Input value={form.name} onChange={setField('name')} placeholder="e.g. Fresh Meats PE" className="mt-1" autoFocus />
          </div>
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
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase">Payment Terms</label>
              <Input value={form.payment_terms} onChange={setField('payment_terms')} placeholder="30d EOM" className="mt-1" />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase">VAT Number</label>
              <Input value={form.tax_id} onChange={setField('tax_id')} placeholder="4123456789" className="mt-1" />
            </div>
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