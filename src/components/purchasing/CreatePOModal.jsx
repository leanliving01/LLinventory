import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { X, Plus, Trash2, Loader2, Receipt } from 'lucide-react';
import { toast } from 'sonner';

export default function CreatePOModal({ onCreated, onCancel, prefillLines }) {
  const [saving, setSaving] = useState(false);
  const [supplierId, setSupplierId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [expectedDate, setExpectedDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState(prefillLines || [{ product_id: '', qty: '', unit_cost: '' }]);
  const [search, setSearch] = useState('');

  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers-active'],
    queryFn: () => base44.entities.Supplier.filter({ status: 'active' }, 'name', 200),
  });

  const { data: locations = [] } = useQuery({
    queryKey: ['locations'],
    queryFn: () => base44.entities.Location.filter({ is_stock_bearing: true }, 'name', 50),
  });

  const { data: products = [] } = useQuery({
    queryKey: ['active-products'],
    queryFn: () => base44.entities.Product.filter({ status: 'active' }, 'name', 500),
  });

  const filteredProducts = useMemo(() => {
    let list = products;
    if (supplierId) {
      const supplierFiltered = list.filter(p => p.supplier_id === supplierId);
      if (supplierFiltered.length > 0) list = supplierFiltered;
    }
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(p => p.name.toLowerCase().includes(q) || (p.sku || '').toLowerCase().includes(q));
    }
    return list.slice(0, 15);
  }, [products, supplierId, search]);

  const addLine = () => setLines(prev => [...prev, { product_id: '', qty: '', unit_cost: '' }]);
  const removeLine = (idx) => setLines(prev => prev.filter((_, i) => i !== idx));
  const updateLine = (idx, field, value) => setLines(prev => prev.map((l, i) => i === idx ? { ...l, [field]: value } : l));

  const validLines = lines.filter(l => l.product_id && Number(l.qty) > 0 && Number(l.unit_cost) >= 0);
  const subtotal = validLines.reduce((s, l) => s + (Number(l.qty) * Number(l.unit_cost)), 0);
  const tax = Math.round(subtotal * 0.15 * 100) / 100; // 15% VAT
  const total = subtotal + tax;

  const generatePONumber = () => {
    const year = new Date().getFullYear();
    const rand = String(Math.floor(Math.random() * 9999) + 1).padStart(4, '0');
    return `PO-${year}-${rand}`;
  };

  const handleCreate = async (asDraft) => {
    if (!supplierId) { toast.error('Select a supplier'); return; }
    if (validLines.length === 0) { toast.error('Add at least one line item'); return; }
    setSaving(true);

    const supplier = suppliers.find(s => s.id === supplierId);
    const poNumber = generatePONumber();

    const po = await base44.entities.PurchaseOrder.create({
      po_number: poNumber,
      supplier_id: supplierId,
      supplier_name: supplier?.name || '',
      location_id: locationId || null,
      status: asDraft ? 'draft' : 'confirmed',
      order_date: new Date().toISOString().slice(0, 10),
      expected_date: expectedDate || null,
      subtotal: Math.round(subtotal * 100) / 100,
      tax: tax,
      total: Math.round(total * 100) / 100,
      currency: 'ZAR',
      payment_status: 'unpaid',
      notes: notes || null,
    });

    // Create line items
    const poLines = validLines.map(l => {
      const product = products.find(p => p.id === l.product_id);
      const qty = Number(l.qty);
      const unitCost = Number(l.unit_cost);
      return {
        purchase_order_id: po.id,
        product_id: l.product_id,
        product_name: product?.name || '',
        product_sku: product?.sku || '',
        ordered_qty: qty,
        received_qty: 0,
        unit_cost: unitCost,
        uom: product?.purchase_uom || product?.stock_uom || 'pcs',
        line_total: Math.round(qty * unitCost * 100) / 100,
      };
    });

    await base44.entities.PurchaseOrderLine.bulkCreate(poLines);

    toast.success(`${poNumber} created as ${asDraft ? 'draft' : 'confirmed'}`);
    setSaving(false);
    onCreated(po);
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-stretch justify-center">
      <div className="bg-card w-full max-w-4xl shadow-xl flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <Receipt className="w-5 h-5 text-primary" />
            <h3 className="text-lg font-bold">New Purchase Order</h3>
          </div>
          <Button variant="ghost" size="icon" onClick={onCancel}><X className="w-5 h-5" /></Button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {/* Header fields */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase">Supplier *</label>
              <Select value={supplierId} onValueChange={setSupplierId}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select supplier..." /></SelectTrigger>
                <SelectContent>
                  {suppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase">Deliver To</label>
              <Select value={locationId} onValueChange={setLocationId}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select location..." /></SelectTrigger>
                <SelectContent>
                  {locations.map(l => <SelectItem key={l.id} value={l.id}>{l.name} ({l.code})</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase">Expected Delivery</label>
              <Input type="date" value={expectedDate} onChange={e => setExpectedDate(e.target.value)} className="mt-1" />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase">Notes</label>
              <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Internal notes..." className="mt-1" />
            </div>
          </div>

          {/* Line items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-semibold">Line Items</h4>
              <Button variant="outline" size="sm" onClick={addLine} className="gap-1"><Plus className="w-3.5 h-3.5" /> Add Line</Button>
            </div>
            <div className="border border-border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/50 border-b border-border">
                    <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Product</th>
                    <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase w-28">Qty</th>
                    <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase w-32">Unit Cost</th>
                    <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase w-28">Total</th>
                    <th className="w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {lines.map((line, idx) => {
                    const lt = (Number(line.qty) || 0) * (Number(line.unit_cost) || 0);
                    const product = products.find(p => p.id === line.product_id);
                    return (
                      <tr key={idx}>
                        <td className="px-3 py-2">
                          <Select value={line.product_id} onValueChange={v => {
                            const p = products.find(pr => pr.id === v);
                            updateLine(idx, 'product_id', v);
                            if (p?.cost_avg && !line.unit_cost) updateLine(idx, 'unit_cost', String(p.cost_avg));
                          }}>
                            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select..." /></SelectTrigger>
                            <SelectContent>
                              <div className="px-2 pb-2">
                                <Input placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} className="h-7 text-xs" />
                              </div>
                              {filteredProducts.map(p => (
                                <SelectItem key={p.id} value={p.id}>{p.sku} — {p.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {product && <p className="text-[10px] text-muted-foreground mt-0.5">{product.purchase_uom || product.stock_uom || ''}</p>}
                        </td>
                        <td className="px-3 py-2">
                          <Input type="number" value={line.qty} onChange={e => updateLine(idx, 'qty', e.target.value)} placeholder="0" className="h-9 text-sm bg-background" min="0" />
                        </td>
                        <td className="px-3 py-2">
                          <Input type="number" value={line.unit_cost} onChange={e => updateLine(idx, 'unit_cost', e.target.value)} placeholder="0.00" className="h-9 text-sm bg-background" min="0" step="0.01" />
                        </td>
                        <td className="px-3 py-2 text-right text-sm font-medium whitespace-nowrap">
                          {lt > 0 ? `R ${lt.toLocaleString('en-ZA', { minimumFractionDigits: 2 })}` : '—'}
                        </td>
                        <td className="px-3 py-2">
                          {lines.length > 1 && (
                            <Button variant="ghost" size="icon" onClick={() => removeLine(idx)} className="h-7 w-7 text-muted-foreground hover:text-destructive">
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Totals */}
          {subtotal > 0 && (
            <div className="bg-muted/50 rounded-lg p-4 space-y-1 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span>R {subtotal.toFixed(2)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">VAT (15%)</span><span>R {tax.toFixed(2)}</span></div>
              <div className="flex justify-between font-bold text-base pt-1 border-t border-border"><span>Total</span><span>R {total.toFixed(2)}</span></div>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-border shrink-0 flex gap-3">
          <Button variant="outline" className="flex-1" onClick={onCancel}>Cancel</Button>
          <Button variant="secondary" className="flex-1 gap-2" onClick={() => handleCreate(true)} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Save as Draft
          </Button>
          <Button className="flex-1 gap-2" onClick={() => handleCreate(false)} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Confirm PO
          </Button>
        </div>
      </div>
    </div>
  );
}