import React, { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FileText, ExternalLink, Plus, Loader2 } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

const DOC_TYPES = [
  { value: 'shopify_ref',    label: 'Shopify reference' },
  { value: 'payment_ref',    label: 'Payment reference' },
  { value: 'fulfilment_ref', label: 'Fulfilment reference' },
  { value: 'courier_ref',    label: 'Courier reference' },
  { value: 'return_ref',     label: 'Return reference' },
  { value: 'resend_ref',     label: 'Re-send reference' },
  { value: 'refund_ref',     label: 'Refund reference' },
  { value: 'attachment',     label: 'Attachment' },
  { value: 'other',          label: 'Other' },
];

export default function DocumentsTab({ order, documents = [] }) {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ doc_type: 'other', label: '', url: '', reference: '', notes: '' });

  const refChips = [
    order.shopify_order_id && { label: 'Shopify Order ID', value: order.shopify_order_id },
    order.payment_reference && { label: 'Payment Ref', value: order.payment_reference },
    order.tracking_number && { label: 'Tracking #', value: order.tracking_number },
  ].filter(Boolean);

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!form.label.trim()) {
      toast.error('Enter a label');
      return;
    }
    setSaving(true);
    try {
      await base44.entities.SalesOrderDocument.create({
        sales_order_id: order.id,
        shopify_order_id: order.shopify_order_id || null,
        order_number: order.order_number || null,
        doc_type: form.doc_type,
        label: form.label,
        url: form.url || null,
        reference: form.reference || null,
        notes: form.notes || null,
      });
      toast.success('Document added');
      setForm({ doc_type: 'other', label: '', url: '', reference: '', notes: '' });
      setShowForm(false);
      queryClient.invalidateQueries({ queryKey: ['salesOrderDocuments', order.id] });
    } catch (err) {
      toast.error(err.message || 'Could not add document');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {refChips.length > 0 && (
        <Card className="p-4">
          <p className="text-sm font-semibold mb-3">Reference Chips</p>
          <div className="flex flex-wrap gap-2">
            {refChips.map((c) => (
              <Badge key={c.label} variant="outline" className="text-[11px] gap-1">
                <span className="text-muted-foreground">{c.label}:</span> {c.value}
              </Badge>
            ))}
          </div>
        </Card>
      )}

      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-semibold flex items-center gap-1.5">
            <FileText className="w-4 h-4" /> Documents & References
          </p>
          <Button size="sm" variant="outline" className="gap-1" onClick={() => setShowForm((v) => !v)}>
            {showForm ? 'Cancel' : <><Plus className="w-3.5 h-3.5" /> Add</>}
          </Button>
        </div>

        {documents.length === 0 ? (
          <p className="text-xs text-muted-foreground">No documents linked to this order.</p>
        ) : (
          <div className="space-y-2">
            {documents.map((d) => (
              <div key={d.id} className="flex items-center justify-between border rounded-lg px-3 py-2 text-sm">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium truncate">{d.label}</span>
                    <Badge variant="outline" className="text-[10px] capitalize">
                      {(d.doc_type || 'other').replace(/_/g, ' ')}
                    </Badge>
                  </div>
                  {d.reference && <p className="text-xs text-muted-foreground">Ref: {d.reference}</p>}
                  {d.notes && <p className="text-xs text-muted-foreground">{d.notes}</p>}
                </div>
                {d.url && (
                  <a
                    href={d.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary inline-flex items-center gap-1 hover:underline shrink-0"
                  >
                    Open <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
            ))}
          </div>
        )}

        {showForm && (
          <form onSubmit={handleAdd} className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3 border-t pt-3">
            <select
              className="text-sm border rounded-md px-2 py-2 bg-background"
              value={form.doc_type}
              onChange={(e) => setForm((f) => ({ ...f, doc_type: e.target.value }))}
            >
              {DOC_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
            <Input
              placeholder="Label"
              value={form.label}
              onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
            />
            <Input
              placeholder="URL (optional)"
              value={form.url}
              onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
            />
            <Input
              placeholder="Reference (optional)"
              value={form.reference}
              onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))}
            />
            <Input
              className="sm:col-span-2"
              placeholder="Notes (optional)"
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            />
            <Button type="submit" disabled={saving} className="gap-1 sm:col-span-2">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Save document
            </Button>
          </form>
        )}
      </Card>
    </div>
  );
}
