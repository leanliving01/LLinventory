import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { X, Loader2, Search, Link2, Truck } from 'lucide-react';
import { formatZAR } from '@/lib/utils';
import { toast } from 'sonner';

const OPEN_STATUSES = ['draft', 'pending_approval', 'approved', 'sent', 'partially_received', 'received', 'invoiced'];

/**
 * Link an existing supplier invoice (e.g. one synced from Xero with no PO) to an
 * existing Purchase Order. Sets purchase_invoices.purchase_order_id so the
 * 3-way match and Order Details views light up.
 */
export default function MatchInvoiceToPOModal({ invoice, onMatched, onCancel }) {
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);

  const { data: pos = [], isLoading } = useQuery({
    queryKey: ['pos-for-invoice-match', invoice.supplier_id],
    queryFn: () => base44.entities.PurchaseOrder.filter({ supplier_id: invoice.supplier_id }, '-order_date', 100),
    enabled: !!invoice.supplier_id,
  });

  const filtered = useMemo(() => {
    const list = pos.filter(p => OPEN_STATUSES.includes(p.status) && p.type !== 'blind_receipt');
    if (!search) return list.slice(0, 25);
    const q = search.toLowerCase();
    return list.filter(p =>
      (p.po_number || '').toLowerCase().includes(q) ||
      (p.status || '').toLowerCase().includes(q)
    ).slice(0, 25);
  }, [pos, search]);

  const link = async (po) => {
    setSaving(true);
    try {
      await base44.entities.PurchaseInvoice.update(invoice.id, { purchase_order_id: po.id });
      toast.success(`Linked ${invoice.invoice_number} to ${po.po_number}`);
      onMatched?.(po);
    } catch (err) {
      toast.error(`Failed: ${err.message}`);
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-[70] flex items-center justify-center p-4">
      <div className="bg-card rounded-2xl border border-border w-full max-w-lg shadow-xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <h3 className="text-lg font-bold flex items-center gap-2">
              <Link2 className="w-5 h-5 text-primary" /> Match to Purchase Order
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
              <Truck className="w-3 h-3" /> {invoice.supplier_name} · {invoice.invoice_number}
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onCancel}><X className="w-5 h-5" /></Button>
        </div>

        <div className="px-6 py-4 space-y-3 flex-1 overflow-y-auto">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              placeholder="Search PO number or status..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="h-9 text-sm pl-8"
              autoFocus
            />
          </div>

          {isLoading ? (
            <div className="text-center py-8 text-sm text-muted-foreground">Loading purchase orders…</div>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              No open purchase orders for {invoice.supplier_name}. Use "Create Blind Receipt" instead.
            </p>
          ) : (
            <div className="space-y-1.5">
              {filtered.map(po => (
                <button
                  key={po.id}
                  onClick={() => !saving && link(po)}
                  disabled={saving}
                  className="w-full text-left px-3 py-2.5 rounded-lg border border-border hover:border-primary/30 hover:bg-primary/5 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <span className="font-medium font-mono text-sm">{po.po_number}</span>
                    <span className="block text-[11px] text-muted-foreground capitalize">
                      {(po.status || '').replace(/_/g, ' ')} · {po.order_date || '—'}
                    </span>
                  </div>
                  <span className="text-sm tabular-nums shrink-0">{formatZAR(po.total || 0)}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-border flex justify-end">
          <Button variant="outline" onClick={onCancel} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Cancel'}
          </Button>
        </div>
      </div>
    </div>
  );
}
