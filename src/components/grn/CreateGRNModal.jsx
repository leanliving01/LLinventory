import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { X, Loader2, PackageCheck } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { nextDocNumber } from '@/lib/docNumbering';

export default function CreateGRNModal({ onCreated, onCancel }) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    supplier_id: '',
    location_id: '',
    purchase_order_id: '',
    received_date: format(new Date(), 'yyyy-MM-dd'),
    notes: '',
  });
  const set = (k, v) => setForm(prev => ({ ...prev, [k]: v }));

  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers-active'],
    queryFn: () => base44.entities.Supplier.filter({ status: 'active' }, 'name', 200),
  });

  const { data: locations = [] } = useQuery({
    queryKey: ['stock-locations'],
    queryFn: () => base44.entities.Location.filter({ is_stock_bearing: true }, 'name', 50),
  });

  // Fetch open POs for the selected supplier
  const { data: openPOs = [] } = useQuery({
    queryKey: ['open-pos-for-grn', form.supplier_id],
    queryFn: () => form.supplier_id
      ? base44.entities.PurchaseOrder.filter({ supplier_id: form.supplier_id }, '-created_date', 50)
        .then(all => all.filter(po => ['approved', 'draft', 'awaiting_approval', 'partially_received'].includes(po.status)))
      : Promise.resolve([]),
    enabled: !!form.supplier_id,
  });

  const selectedSupplier = suppliers.find(s => s.id === form.supplier_id);
  const selectedLocation = locations.find(l => l.id === form.location_id);

  const handleCreate = async () => {
    if (!form.supplier_id) { toast.error('Select a supplier'); return; }
    if (!form.location_id) { toast.error('Select a receiving location'); return; }
    setSaving(true);

    let grn;
    try {
      // Generate GRN number
      const grnNumber = await nextDocNumber('GRN');

      grn = await base44.entities.GoodsReceivedNote.create({
        grn_number: grnNumber,
        supplier_id: form.supplier_id,
        supplier_name: selectedSupplier?.name || '',
        location_id: form.location_id,
        location_name: selectedLocation?.name || '',
        purchase_order_id: form.purchase_order_id || undefined,
        received_date: form.received_date,
        status: 'draft',
        notes: form.notes,
      });

      // If linked to PO, pre-populate lines from PO lines
      if (form.purchase_order_id) {
        const poLines = await base44.entities.PurchaseOrderLine.filter(
          { purchase_order_id: form.purchase_order_id }, 'product_name', 100
        );
        if (poLines.length > 0) {
          // Fetch supplier products to get conversion data
          const sps = await base44.entities.SupplierProduct.filter(
            { supplier_id: form.supplier_id, active: true }, 'product_name', 200
          );
          const spMap = {};
          sps.forEach(sp => { spMap[sp.product_id] = sp; });

          const grnLines = poLines.map(pl => {
            const sp = pl.supplier_product_id ? sps.find(s => s.id === pl.supplier_product_id) : spMap[pl.product_id];
            return {
              grn_id: grn.id,
              po_line_id: pl.id,
              supplier_product_id: sp?.id || pl.supplier_product_id || null,
              product_id: pl.product_id,
              product_name: pl.product_name || '',
              product_sku: pl.product_sku || '',
              expected_qty: pl.ordered_qty || 0,
              received_qty: pl.ordered_qty || 0, // Pre-fill with expected
              variance_qty: 0,
              purchase_uom: sp?.purchase_uom || pl.purchase_uom || pl.uom || '',
              conversion_factor: sp?.conversion_factor || 1,
              yield_factor: sp?.yield_factor || 1,
              unit_cost: pl.unit_cost || sp?.last_purchase_price || 0,
              line_total: (pl.ordered_qty || 0) * (pl.unit_cost || 0),
              condition: 'accepted',
              item_type: 'stock',
            };
          });
          await base44.entities.GRNLine.bulkCreate(grnLines);
          await base44.entities.GoodsReceivedNote.update(grn.id, { total_lines: grnLines.length });
        }
      }

      toast.success(`GRN ${grnNumber} created`);
    } catch (err) {
      toast.error('Save failed: ' + (err.message || 'Unknown error'));
    } finally {
      setSaving(false);
    }

    onCreated(grn);
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-card rounded-2xl border border-border w-full max-w-md shadow-xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <PackageCheck className="w-5 h-5 text-primary" />
            <h3 className="text-lg font-bold">New Goods Received Note</h3>
          </div>
          <Button variant="ghost" size="icon" onClick={onCancel}><X className="w-5 h-5" /></Button>
        </div>

        <div className="px-6 py-4 space-y-4">
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase">Supplier *</label>
            <Select value={form.supplier_id} onValueChange={v => { set('supplier_id', v); set('purchase_order_id', ''); }}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Select supplier" /></SelectTrigger>
              <SelectContent>
                {suppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase">Receive Into *</label>
            <Select value={form.location_id} onValueChange={v => set('location_id', v)}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Select location" /></SelectTrigger>
              <SelectContent>
                {locations.map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {openPOs.length > 0 && (
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase">Link to PO (optional)</label>
              <Select value={form.purchase_order_id} onValueChange={v => set('purchase_order_id', v)}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Blind receipt (no PO)" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={null}>Blind receipt (no PO)</SelectItem>
                  {openPOs.map(po => (
                    <SelectItem key={po.id} value={po.id}>
                      {po.po_number} — R {(po.total || 0).toFixed(2)} ({po.status})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase">Received Date</label>
            <Input type="date" value={form.received_date} onChange={e => set('received_date', e.target.value)} className="mt-1" />
          </div>

          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase">Notes</label>
            <Textarea value={form.notes} onChange={e => set('notes', e.target.value)} className="mt-1 h-16" placeholder="Delivery note number, driver name, etc." />
          </div>
        </div>

        <div className="px-6 py-4 border-t border-border flex gap-3">
          <Button variant="outline" className="flex-1" onClick={onCancel}>Cancel</Button>
          <Button className="flex-1 gap-2" onClick={handleCreate} disabled={saving || !form.supplier_id || !form.location_id}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <PackageCheck className="w-4 h-4" />}
            {saving ? 'Creating...' : 'Create GRN'}
          </Button>
        </div>
      </div>
    </div>
  );
}