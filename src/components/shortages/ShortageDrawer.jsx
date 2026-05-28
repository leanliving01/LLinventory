import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  X, AlertTriangle, Truck, Package, Calendar,
  Save, Loader2, CheckCircle2
} from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { writeAuditLog } from '@/lib/auditLog';

const STATUS_STYLES = {
  open: 'bg-amber-100 text-amber-700',
  follow_up_delivery: 'bg-blue-100 text-blue-700',
  credit_received: 'bg-green-100 text-green-700',
  written_off: 'bg-gray-100 text-gray-500',
};

const STATUS_LABELS = {
  open: 'Open',
  follow_up_delivery: 'Follow-up Delivery',
  credit_received: 'Credit Received',
  written_off: 'Written Off',
};

function Field({ label, children }) {
  return (
    <div>
      <label className="text-[10px] uppercase text-muted-foreground font-semibold block mb-1">{label}</label>
      {children}
    </div>
  );
}

export default function ShortageDrawer({ shortage, onClose, onUpdated, canResolve }) {
  const [resolving, setResolving] = useState(false);
  const [showResolve, setShowResolve] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    status: '',
    resolution_notes: '',
    credit_note_number: '',
    resolution_date: format(new Date(), 'yyyy-MM-dd'),
  });

  const handleResolve = async () => {
    if (!form.status) { toast.error('Select a resolution'); return; }
    setSaving(true);

    try {
      await base44.entities.SupplierShortage.update(shortage.id, {
        status: form.status,
        resolution_date: form.resolution_date,
        resolution_notes: form.resolution_notes,
        credit_note_number: form.credit_note_number || undefined,
      });
      writeAuditLog({
        action: 'resolve',
        entity_type: 'SupplierShortage',
        entity_id: shortage.id,
        description: `Resolved shortage: ${shortage.product_name} — ${form.status.replace('_', ' ')}`,
      });
      toast.success('Shortage resolved');
    } catch (err) {
      toast.error('Save failed: ' + (err.message || 'Unknown error'));
    } finally {
      setSaving(false);
    }

    onUpdated?.();
    onClose();
  };

  const isOpen = shortage.status === 'open';

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md bg-card shadow-xl flex flex-col">
        {/* Header */}
        <div className="sticky top-0 bg-card border-b border-border px-6 py-4 flex items-start justify-between z-10 shrink-0">
          <div>
            <Badge className={`text-[10px] mb-1 ${STATUS_STYLES[shortage.status] || ''}`}>
              {STATUS_LABELS[shortage.status] || shortage.status}
            </Badge>
            <h2 className="text-lg font-bold flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-600" />
              Shortage Detail
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {shortage.product_name} — {shortage.product_sku}
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}><X className="w-5 h-5" /></Button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          {/* Shortage details */}
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Short Quantity</span>
              <span className="font-bold text-amber-700">{shortage.shortage_qty} {shortage.purchase_uom}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Unit Cost</span>
              <span className="font-medium">R {(shortage.unit_cost || 0).toFixed(2)}</span>
            </div>
            <div className="border-t border-amber-200 pt-2 flex justify-between text-sm">
              <span className="text-muted-foreground font-semibold">Shortage Value</span>
              <span className="font-bold text-amber-700">R {(shortage.shortage_value || 0).toFixed(2)}</span>
            </div>
          </div>

          {/* Supplier info */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <Truck className="w-4 h-4 text-muted-foreground" />
              <span className="text-muted-foreground">Supplier:</span>
              <span className="font-medium">{shortage.supplier_name}</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Package className="w-4 h-4 text-muted-foreground" />
              <span className="text-muted-foreground">Product:</span>
              <span className="font-medium">{shortage.product_name} ({shortage.product_sku})</span>
            </div>
          </div>

          {/* Resolution info (if resolved) */}
          {!isOpen && (
            <div className="bg-muted/30 border border-border rounded-xl p-4 space-y-2">
              <h3 className="text-sm font-semibold">Resolution</h3>
              {shortage.resolution_date && (
                <div className="flex items-center gap-2 text-sm">
                  <Calendar className="w-4 h-4 text-muted-foreground" />
                  <span>{shortage.resolution_date}</span>
                </div>
              )}
              {shortage.credit_note_number && (
                <div className="text-sm">
                  <span className="text-muted-foreground">Credit Note: </span>
                  <span className="font-mono font-medium">{shortage.credit_note_number}</span>
                </div>
              )}
              {shortage.resolution_notes && (
                <p className="text-sm text-muted-foreground">{shortage.resolution_notes}</p>
              )}
            </div>
          )}

          {/* Resolve form */}
          {isOpen && showResolve && (
            <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 space-y-4">
              <h3 className="text-sm font-semibold">Resolve Shortage</h3>
              <Field label="Resolution *">
                <Select value={form.status} onValueChange={v => setForm(p => ({ ...p, status: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select resolution..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="follow_up_delivery">Follow-up Delivery Expected</SelectItem>
                    <SelectItem value="credit_received">Credit Note Received</SelectItem>
                    <SelectItem value="written_off">Write Off</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              {form.status === 'credit_received' && (
                <Field label="Credit Note Number">
                  <Input
                    value={form.credit_note_number}
                    onChange={e => setForm(p => ({ ...p, credit_note_number: e.target.value }))}
                    placeholder="CN-12345"
                  />
                </Field>
              )}
              <Field label="Resolution Date">
                <Input
                  type="date"
                  value={form.resolution_date}
                  onChange={e => setForm(p => ({ ...p, resolution_date: e.target.value }))}
                />
              </Field>
              <Field label="Notes">
                <Textarea
                  value={form.resolution_notes}
                  onChange={e => setForm(p => ({ ...p, resolution_notes: e.target.value }))}
                  placeholder="Details about the resolution..."
                  className="h-20"
                />
              </Field>
            </div>
          )}
        </div>

        {/* Footer */}
        {isOpen && canResolve && (
          <div className="sticky bottom-0 bg-card border-t border-border px-6 py-3 shrink-0 flex gap-3">
            {!showResolve ? (
              <Button onClick={() => setShowResolve(true)} className="flex-1 gap-2">
                <CheckCircle2 className="w-4 h-4" /> Resolve Shortage
              </Button>
            ) : (
              <>
                <Button variant="outline" className="flex-1" onClick={() => setShowResolve(false)}>Cancel</Button>
                <Button className="flex-1 gap-2" onClick={handleResolve} disabled={saving || !form.status}>
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  {saving ? 'Saving...' : 'Confirm Resolution'}
                </Button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}