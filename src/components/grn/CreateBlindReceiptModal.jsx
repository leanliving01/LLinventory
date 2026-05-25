import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { X, Plus, Trash2, Loader2, PackageCheck, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { confirmGRN } from './GRNConfirmLogic';
import { useAuth } from '@/lib/AuthContext';

export default function CreateBlindReceiptModal({ onCreated, onCancel }) {
  const { user } = useAuth();
  const [saving, setSaving] = useState(false);
  const [supplierId, setSupplierId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState([{ product_id: '', qty: '', unit_cost: '', uom: '', supplier_product_id: '' }]);
  const [search, setSearch] = useState('');
  const [duplicateInvoice, setDuplicateInvoice] = useState(null);

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

  const { data: supplierProducts = [], isLoading: isLoadingSPs } = useQuery({
    queryKey: ['supplier-products-for-br', supplierId],
    queryFn: () => base44.entities.SupplierProduct.filter({ supplier_id: supplierId, active: true }, 'product_name', 200),
    enabled: !!supplierId,
  });

  const spByProductId = useMemo(() => {
    const map = {};
    supplierProducts.forEach(sp => { map[sp.product_id] = sp; });
    return map;
  }, [supplierProducts]);

  const filteredProducts = useMemo(() => {
    let list = products;
    if (supplierId && supplierProducts.length > 0) {
      const spIds = new Set(supplierProducts.map(sp => sp.product_id));
      list = list.filter(p => spIds.has(p.id));
    }
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(p => {
        const sp = spByProductId[p.id];
        return (
          p.name.toLowerCase().includes(q) ||
          (p.sku || '').toLowerCase().includes(q) ||
          (sp?.supplier_sku || '').toLowerCase().includes(q) ||
          (sp?.supplier_description || '').toLowerCase().includes(q)
        );
      });
    }
    return list.slice(0, 25);
  }, [products, supplierId, supplierProducts, spByProductId, search]);

  const addLine = () => setLines(prev => [...prev, { product_id: '', qty: '', unit_cost: '', uom: '', supplier_product_id: '' }]);
  const removeLine = idx => setLines(prev => prev.filter((_, i) => i !== idx));

  const selectProduct = (idx, productId) => {
    const p = products.find(pr => pr.id === productId);
    const sp = spByProductId[productId];
    const uom = sp?.purchase_uom_label || sp?.purchase_uom || p?.purchase_uom || p?.stock_uom || 'pcs';
    const cost = sp?.last_purchase_price || p?.cost_avg || 0;
    setLines(prev => prev.map((l, i) => i === idx ? {
      ...l,
      product_id: productId,
      supplier_product_id: sp?.id || '',
      uom,
      unit_cost: l.unit_cost || (cost > 0 ? String(cost) : ''),
    } : l));
  };

  const updateLine = (idx, field, value) => setLines(prev => prev.map((l, i) => i === idx ? { ...l, [field]: value } : l));

  const validLines = lines.filter(l => l.product_id && Number(l.qty) > 0 && Number(l.unit_cost) >= 0);
  const subtotal = validLines.reduce((s, l) => s + (Number(l.qty) * Number(l.unit_cost)), 0);
  const tax = Math.round(subtotal * 0.15 * 100) / 100;
  const total = subtotal + tax;

  const checkDuplicateInvoice = async () => {
    if (!invoiceNumber || !supplierId) return null;
    const existing = await base44.entities.PurchaseInvoice.filter({
      supplier_id: supplierId,
      invoice_number: invoiceNumber,
    });
    return existing[0] || null;
  };

  const generateGRNNumber = async () => {
    const prefix = `GRN-${new Date().getFullYear()}-`;
    try {
      const existing = await base44.entities.GoodsReceivedNote.list('grn_number', 500);
      const maxSeq = existing.reduce((max, g) => {
        if (!(g.grn_number || '').startsWith(prefix)) return max;
        const n = parseInt(g.grn_number.slice(prefix.length), 10);
        return isNaN(n) ? max : Math.max(max, n);
      }, 0);
      return `${prefix}${String(maxSeq + 1).padStart(4, '0')}`;
    } catch {
      return `${prefix}${String(Math.floor(Math.random() * 9999) + 1).padStart(4, '0')}`;
    }
  };

  const handleConfirm = async () => {
    if (!supplierId) { toast.error('Select a supplier'); return; }
    if (!locationId) { toast.error('Select a delivery location'); return; }
    if (!invoiceNumber.trim()) { toast.error('Enter the supplier invoice number'); return; }
    if (validLines.length === 0) { toast.error('Add at least one line item'); return; }

    setSaving(true);
    try {
      // Duplicate invoice guard
      const dup = await checkDuplicateInvoice();
      if (dup) {
        setDuplicateInvoice(dup);
        setSaving(false);
        return;
      }

      const supplier = suppliers.find(s => s.id === supplierId);
      const today = new Date().toISOString().slice(0, 10);
      const grnNumber = await generateGRNNumber();

      // 1. Create blind PO
      const po = await base44.entities.PurchaseOrder.create({
        po_number: `BR-${grnNumber}`,
        supplier_id: supplierId,
        supplier_name: supplier?.name || '',
        location_id: locationId,
        status: 'received',
        type: 'blind_receipt',
        order_date: today,
        expected_date: today,
        subtotal: Math.round(subtotal * 100) / 100,
        tax: tax,
        total: Math.round(total * 100) / 100,
        currency: 'ZAR',
        payment_status: 'unpaid',
        notes: notes || null,
      });

      // 2. Create PO lines
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
          received_qty: qty,
          unit_cost: unitCost,
          uom: l.uom || product?.stock_uom || 'pcs',
          line_total: Math.round(qty * unitCost * 100) / 100,
        };
      });
      await base44.entities.PurchaseOrderLine.bulkCreate(poLines);

      // 3. Create GRN
      const grn = await base44.entities.GoodsReceivedNote.create({
        grn_number: grnNumber,
        purchase_order_id: po.id,
        supplier_id: supplierId,
        supplier_name: supplier?.name || '',
        location_id: locationId,
        status: 'draft',
        received_date: today,
        notes: notes || null,
      });

      // 4. Build GRN lines for confirmGRN
      const grnLines = validLines.map(l => {
        const product = products.find(p => p.id === l.product_id);
        const sp = spByProductId[l.product_id];
        const qty = Number(l.qty);
        const unitCost = Number(l.unit_cost);
        const cf = sp?.conversion_factor || sp?.purchase_to_stock_factor || 1;
        return {
          grn_id: grn.id,
          product_id: l.product_id,
          product_name: product?.name || '',
          product_sku: product?.sku || '',
          supplier_product_id: l.supplier_product_id || null,
          expected_qty: qty,
          received_qty: qty,
          unit_cost: unitCost,
          purchase_uom: l.uom || '',
          conversion_factor: cf,
          yield_factor: 1,
          condition: 'accepted',
          item_type: 'stock',
        };
      });

      // 5. Confirm GRN (creates movements, updates SOH and cost_avg)
      await confirmGRN(grn, grnLines, user?.full_name || user?.email || 'System');

      // 6. Create PurchaseInvoice
      await base44.entities.PurchaseInvoice.create({
        invoice_number: invoiceNumber.trim(),
        supplier_id: supplierId,
        supplier_name: supplier?.name || '',
        purchase_order_id: po.id,
        grn_id: grn.id,
        invoice_date: invoiceDate,
        subtotal: Math.round(subtotal * 100) / 100,
        tax_amount: tax,
        total: Math.round(total * 100) / 100,
        currency: 'ZAR',
        status: 'pending_match',
        payment_status: 'unpaid',
        source: 'manual',
        notes: notes || null,
      });

      toast.success(`Blind receipt ${grnNumber} confirmed — stock updated`);
      onCreated(po);
    } catch (err) {
      console.error('[CreateBlindReceiptModal]', err);
      toast.error(`Failed: ${err.message || 'Unknown error'}`);
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-stretch justify-center">
      <div className="bg-card w-full max-w-4xl shadow-xl flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <PackageCheck className="w-5 h-5 text-primary" />
            <h3 className="text-lg font-bold">Blind Receipt</h3>
            <span className="text-xs text-muted-foreground">No PO required — receive stock directly</span>
          </div>
          <Button variant="ghost" size="icon" onClick={onCancel}><X className="w-5 h-5" /></Button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {duplicateInvoice && (
            <div className="flex items-start gap-2 rounded-lg bg-destructive/10 border border-destructive/30 p-3 text-sm text-destructive">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Duplicate invoice number</p>
                <p className="text-xs mt-0.5">Invoice <strong>{invoiceNumber}</strong> already exists for this supplier (recorded {duplicateInvoice.invoice_date || 'unknown date'}). Please check the invoice number and try again.</p>
                <Button variant="link" size="sm" className="h-auto p-0 mt-1 text-destructive text-xs" onClick={() => setDuplicateInvoice(null)}>Dismiss and edit</Button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase">Supplier *</label>
              <Select value={supplierId} onValueChange={v => { setSupplierId(v); setLines([{ product_id: '', qty: '', unit_cost: '', uom: '', supplier_product_id: '' }]); }}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select supplier..." /></SelectTrigger>
                <SelectContent>
                  {suppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase">Deliver To *</label>
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
              <label className="text-xs font-semibold text-muted-foreground uppercase">Supplier Invoice Number *</label>
              <Input value={invoiceNumber} onChange={e => { setInvoiceNumber(e.target.value); setDuplicateInvoice(null); }} placeholder="e.g. INV-2024-001" className="mt-1" />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase">Invoice Date</label>
              <Input type="date" value={invoiceDate} onChange={e => setInvoiceDate(e.target.value)} className="mt-1" />
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase">Notes</label>
            <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Reason for blind receipt, driver name, etc." className="mt-1" />
          </div>

          {/* Line items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-semibold">Items Received</h4>
              <Button variant="outline" size="sm" onClick={addLine} className="gap-1"><Plus className="w-3.5 h-3.5" /> Add Line</Button>
            </div>
            <div className="border border-border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/50 border-b border-border">
                    <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Product</th>
                    <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase w-28">Qty Received</th>
                    <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase w-32">Unit Cost (excl. VAT)</th>
                    <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase w-28">Line Total</th>
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
                          <Select value={line.product_id} onValueChange={v => selectProduct(idx, v)}>
                            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select product..." /></SelectTrigger>
                            <SelectContent>
                              <div className="px-2 pb-2">
                                <Input
                                  placeholder={isLoadingSPs ? 'Loading...' : 'Search...'}
                                  value={search}
                                  onChange={e => setSearch(e.target.value)}
                                  className="h-7 text-xs"
                                  disabled={isLoadingSPs}
                                />
                              </div>
                              {filteredProducts.map(p => {
                                const sp = spByProductId[p.id];
                                return (
                                  <SelectItem key={p.id} value={p.id}>
                                    <span className="font-mono text-xs text-muted-foreground">{p.sku}</span>
                                    {' — '}
                                    {sp?.supplier_description ? (
                                      <><span className="font-medium">{sp.supplier_description}</span><span className="text-muted-foreground"> / {p.name}</span></>
                                    ) : p.name}
                                    {sp?.last_purchase_price > 0 && <span className="text-muted-foreground"> @ R{Number(sp.last_purchase_price).toFixed(2)}</span>}
                                  </SelectItem>
                                );
                              })}
                            </SelectContent>
                          </Select>
                          {product && (
                            <p className="text-[10px] text-muted-foreground mt-0.5">
                              {line.uom || spByProductId[line.product_id]?.purchase_uom_label || product.purchase_uom || product.stock_uom || ''}
                            </p>
                          )}
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
          <Button className="flex-1 gap-2" onClick={handleConfirm} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <PackageCheck className="w-4 h-4" />}
            Confirm Receipt & Update Stock
          </Button>
        </div>
      </div>
    </div>
  );
}
