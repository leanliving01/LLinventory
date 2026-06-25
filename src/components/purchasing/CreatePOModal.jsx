import React, { useState, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SearchableSelect } from '@/components/ui/SearchableSelect';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { X, Plus, Trash2, Loader2, Receipt, PackageCheck, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { calculateDueDate, formatPaymentTerms, toISODate } from '@/lib/utils';
import { nextDocNumber } from '@/lib/docNumbering';
import { resolveTaxRate } from '@/lib/taxResolution';
import { confirmGRN } from '@/components/grn/GRNConfirmLogic';
import { useAuth } from '@/lib/AuthContext';

export default function CreatePOModal({ onCreated, onCancel, prefillLines }) {
  const { user } = useAuth();
  const [saving, setSaving] = useState(false);
  const [isBlindReceipt, setIsBlindReceipt] = useState(false);
  const [pendingToggle, setPendingToggle] = useState(false);

  // Common fields
  const [supplierId, setSupplierId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState(prefillLines || [{ product_id: '', qty: '', unit_cost: '', uom: '', supplier_product_id: '' }]);
  const [search, setSearch] = useState('');

  // Formal PO fields
  const [expectedDate, setExpectedDate] = useState(new Date().toISOString().slice(0, 10));

  // Blind receipt fields
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState('');
  const [dueDateOverridden, setDueDateOverridden] = useState(false);
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
    queryKey: ['supplier-products-for-po', supplierId],
    queryFn: () => base44.entities.SupplierProduct.filter({ supplier_id: supplierId, active: true }, 'product_name', 200),
    enabled: !!supplierId,
  });

  const { data: taxRates = [] } = useQuery({
    queryKey: ['tax-rates'],
    queryFn: () => base44.entities.TaxRate.filter({ active: true }, 'name', 20),
    staleTime: 300000,
  });

  const selectedSupplier = useMemo(() => suppliers.find(s => s.id === supplierId), [suppliers, supplierId]);

  // Auto-calculate due date from supplier payment terms whenever supplier or invoiceDate changes
  useEffect(() => {
    if (!isBlindReceipt || dueDateOverridden) return;
    if (!selectedSupplier?.payment_term_type || !invoiceDate) {
      setDueDate('');
      return;
    }
    const calculated = calculateDueDate(invoiceDate, selectedSupplier.payment_term_type, selectedSupplier.payment_term_value);
    setDueDate(calculated ? toISODate(calculated) : '');
  }, [supplierId, invoiceDate, isBlindReceipt, dueDateOverridden, selectedSupplier]);

  const spByProductId = useMemo(() => {
    const map = {};
    supplierProducts.forEach(sp => { map[sp.product_id] = sp; });
    return map;
  }, [supplierProducts]);

  const spSearchMap = useMemo(() => {
    const map = {};
    supplierProducts.forEach(sp => {
      map[sp.product_id] = {
        supplierSku: (sp.supplier_sku || '').toLowerCase(),
        supplierDesc: (sp.supplier_description || '').toLowerCase(),
        purchaseUom: sp.purchase_uom_label || sp.purchase_uom || '',
        lastPrice: sp.last_purchase_price || 0,
        varianceThreshold: sp.price_variance_threshold || 0.1,
      };
    });
    return map;
  }, [supplierProducts]);

  const filteredProducts = useMemo(() => {
    let list = products;
    if (supplierId && supplierProducts.length > 0) {
      const spProductIds = new Set(supplierProducts.map(sp => sp.product_id));
      list = list.filter(p => spProductIds.has(p.id));
    } else if (supplierId) {
      const supplierFiltered = list.filter(p => p.supplier_id === supplierId);
      if (supplierFiltered.length > 0) list = supplierFiltered;
    }
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(p => {
        const sp = spSearchMap[p.id];
        return (
          p.name.toLowerCase().includes(q) ||
          (p.sku || '').toLowerCase().includes(q) ||
          (sp?.supplierSku || '').includes(q) ||
          (sp?.supplierDesc || '').includes(q)
        );
      });
    }
    return list.slice(0, 25);
  }, [products, supplierId, supplierProducts, spSearchMap, search]);

  // Supplier-scoped product list (unfiltered) — SearchableSelect filters internally
  const scopedProducts = useMemo(() => {
    let list = products;
    if (supplierId && supplierProducts.length > 0) {
      const spProductIds = new Set(supplierProducts.map(sp => sp.product_id));
      list = list.filter(p => spProductIds.has(p.id));
    } else if (supplierId) {
      const supplierFiltered = list.filter(p => p.supplier_id === supplierId);
      if (supplierFiltered.length > 0) list = supplierFiltered;
    }
    return list;
  }, [products, supplierId, supplierProducts]);

  // Resolve PO-level tax rate from supplier
  const poTaxRate = useMemo(() => resolveTaxRate(null, selectedSupplier, taxRates), [selectedSupplier, taxRates]);

  const addLine = () => setLines(prev => [...prev, { product_id: '', qty: '', unit_cost: '', uom: '', supplier_product_id: '' }]);
  const removeLine = idx => setLines(prev => prev.filter((_, i) => i !== idx));
  const updateLine = (idx, field, value) => setLines(prev => prev.map((l, i) => i === idx ? { ...l, [field]: value } : l));

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

  const validLines = lines.filter(l => l.product_id && Number(l.qty) > 0 && Number(l.unit_cost) >= 0);
  const subtotal = validLines.reduce((s, l) => s + (Number(l.qty) * Number(l.unit_cost)), 0);
  const tax = Math.round(subtotal * poTaxRate * 100) / 100;
  const total = subtotal + tax;

  // Handle blind receipt toggle
  const handleBlindReceiptToggle = (checked) => {
    const hasLines = lines.some(l => l.product_id);
    if (!checked && hasLines && invoiceNumber) {
      // Show warning before clearing invoice fields
      setPendingToggle(true);
      return;
    }
    setIsBlindReceipt(checked);
    if (!checked) {
      setInvoiceNumber('');
      setDueDate('');
      setDueDateOverridden(false);
    }
  };

  const confirmToggle = () => {
    setPendingToggle(false);
    setIsBlindReceipt(false);
    setInvoiceNumber('');
    setDueDate('');
    setDueDateOverridden(false);
  };

  const handleDueDateOverride = (val) => {
    setDueDate(val);
    setDueDateOverridden(true);
  };

  const checkDuplicateInvoice = async () => {
    if (!invoiceNumber || !supplierId) return null;
    const existing = await base44.entities.PurchaseInvoice.filter({
      supplier_id: supplierId,
      invoice_number: invoiceNumber.trim(),
    });
    return existing[0] || null;
  };

  const handleCreate = async (asDraft) => {
    if (!supplierId) { toast.error('Select a supplier'); return; }
    if (isBlindReceipt && !locationId) { toast.error('Select a delivery location'); return; }
    if (isBlindReceipt && !invoiceNumber.trim()) { toast.error('Enter the supplier invoice number'); return; }
    if (validLines.length === 0) { toast.error('Add at least one line item'); return; }

    setSaving(true);
    try {
      const supplier = selectedSupplier;
      const today = new Date().toISOString().slice(0, 10);
      const prefix = isBlindReceipt ? 'BR' : 'PO';
      const docNumber = await nextDocNumber(prefix);

      if (isBlindReceipt) {
        // Duplicate invoice guard
        const dup = await checkDuplicateInvoice();
        if (dup) {
          setDuplicateInvoice(dup);
          setSaving(false);
          return;
        }

        const calculatedDueDate = !dueDateOverridden && selectedSupplier?.payment_term_type
          ? toISODate(calculateDueDate(invoiceDate, selectedSupplier.payment_term_type, selectedSupplier.payment_term_value))
          : null;

        // 1. Create blind PO
        const po = await base44.entities.PurchaseOrder.create({
          po_number: docNumber,
          supplier_id: supplierId,
          supplier_name: supplier?.name || '',
          location_id: locationId || null,
          status: 'received',
          type: 'blind_receipt',
          order_date: today,
          expected_date: today,
          supplier_invoice_number: invoiceNumber.trim(),
          subtotal: Math.round(subtotal * 100) / 100,
          tax_amount: tax,
          total: Math.round(total * 100) / 100,
          currency: 'ZAR',
          payment_status: 'unpaid',
          notes: notes || null,
          due_date: dueDate || null,
          due_date_calculated: calculatedDueDate || null,
          due_date_overridden: dueDateOverridden,
        });

        const grnNumber = await nextDocNumber('GRN');

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
          received_date: invoiceDate || today,
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

        // 5. Confirm GRN
        await confirmGRN(grn, grnLines, user?.full_name || user?.email || 'System');

        // 6. Create PurchaseInvoice
        await base44.entities.PurchaseInvoice.create({
          invoice_number: invoiceNumber.trim(),
          supplier_id: supplierId,
          supplier_name: supplier?.name || '',
          purchase_order_id: po.id,
          grn_id: grn.id,
          invoice_date: invoiceDate,
          due_date: dueDate || null,
          due_date_calculated: calculatedDueDate || null,
          due_date_overridden: dueDateOverridden,
          subtotal: Math.round(subtotal * 100) / 100,
          tax_amount: tax,
          total: Math.round(total * 100) / 100,
          currency: 'ZAR',
          status: 'pending_match',
          payment_status: 'unpaid',
          source: 'manual',
          notes: notes || null,
        });

        toast.success(`Blind receipt ${docNumber} confirmed — stock updated`);
        onCreated(po);
      } else {
        // Formal PO creation
        const po = await base44.entities.PurchaseOrder.create({
          po_number: docNumber,
          supplier_id: supplierId,
          supplier_name: supplier?.name || '',
          location_id: locationId || null,
          status: asDraft ? 'draft' : 'approved',
          type: 'formal_po',
          order_date: today,
          expected_date: expectedDate || null,
          subtotal: Math.round(subtotal * 100) / 100,
          tax_amount: tax,
          total: Math.round(total * 100) / 100,
          currency: 'ZAR',
          payment_status: 'unpaid',
          notes: notes || null,
        });

        const poLines = validLines.map(l => {
          const product = products.find(p => p.id === l.product_id);
          const sp = spByProductId[l.product_id];
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
            uom: sp?.purchase_uom_label || sp?.purchase_uom || product?.purchase_uom || product?.stock_uom || 'pcs',
            line_total: Math.round(qty * unitCost * 100) / 100,
          };
        });
        await base44.entities.PurchaseOrderLine.bulkCreate(poLines);

        toast.success(`${docNumber} created as ${asDraft ? 'draft' : 'approved'}`);
        setSaving(false);
        onCreated(po);
      }
    } catch (err) {
      console.error('[CreatePOModal]', err);
      toast.error(`Failed: ${err.message || 'Unknown error'}`);
      setSaving(false);
    }
  };

  const taxRatePct = Math.round(poTaxRate * 100);
  const termsText = selectedSupplier?.payment_term_type
    ? formatPaymentTerms(selectedSupplier.payment_term_type, selectedSupplier.payment_term_value)
    : null;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-stretch justify-center">
      <div className="bg-card w-full max-w-4xl shadow-xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            {isBlindReceipt
              ? <PackageCheck className="w-5 h-5 text-primary" />
              : <Receipt className="w-5 h-5 text-primary" />}
            <h3 className="text-lg font-bold">
              {isBlindReceipt ? 'New Blind Receipt' : 'New Purchase Order'}
            </h3>
          </div>
          <Button variant="ghost" size="icon" onClick={onCancel}><X className="w-5 h-5" /></Button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {/* Blind Receipt toggle */}
          <div className="flex items-center gap-3 bg-muted/40 border border-border rounded-lg px-4 py-3">
            <Checkbox
              id="blind-receipt-toggle"
              checked={isBlindReceipt}
              onCheckedChange={handleBlindReceiptToggle}
            />
            <div>
              <Label htmlFor="blind-receipt-toggle" className="text-sm font-medium cursor-pointer">
                Blind Receipt
              </Label>
              <p className="text-xs text-muted-foreground">Invoice arrived — no prior purchase order was raised</p>
            </div>
          </div>

          {/* Toggle warning */}
          {pendingToggle && (
            <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-medium text-amber-800">Change purchase type?</p>
                <p className="text-xs text-amber-700 mt-0.5">Lines will be kept — invoice number and due date will be cleared.</p>
              </div>
              <div className="flex gap-2 shrink-0">
                <Button size="sm" variant="outline" onClick={() => setPendingToggle(false)}>Keep</Button>
                <Button size="sm" onClick={confirmToggle}>Clear & Switch</Button>
              </div>
            </div>
          )}

          {/* Duplicate invoice warning */}
          {duplicateInvoice && (
            <div className="flex items-start gap-2 rounded-lg bg-destructive/10 border border-destructive/30 p-3 text-sm text-destructive">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Duplicate invoice number</p>
                <p className="text-xs mt-0.5">
                  Invoice <strong>{invoiceNumber}</strong> already exists for this supplier
                  {duplicateInvoice.invoice_date ? ` (recorded ${duplicateInvoice.invoice_date})` : ''}.
                </p>
                <Button variant="link" size="sm" className="h-auto p-0 mt-1 text-destructive text-xs" onClick={() => setDuplicateInvoice(null)}>Dismiss and edit</Button>
              </div>
            </div>
          )}

          {/* Supplier and location */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase">Supplier *</label>
              <Select value={supplierId} onValueChange={v => { setSupplierId(v); setDueDateOverridden(false); }}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select supplier..." /></SelectTrigger>
                <SelectContent>
                  {suppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
              {termsText && (
                <p className="text-[10px] text-muted-foreground mt-0.5">Payment terms: {termsText}</p>
              )}
              {supplierId && !selectedSupplier?.payment_term_type && isBlindReceipt && (
                <p className="text-[10px] text-amber-600 mt-0.5 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> No payment terms — enter due date manually
                </p>
              )}
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase">
                {isBlindReceipt ? 'Deliver To *' : 'Deliver To'}
              </label>
              <Select value={locationId} onValueChange={setLocationId}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select location..." /></SelectTrigger>
                <SelectContent>
                  {locations.map(l => <SelectItem key={l.id} value={l.id}>{l.name} ({l.code})</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Formal PO fields */}
          {!isBlindReceipt && (
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
          )}

          {/* Blind Receipt fields */}
          {isBlindReceipt && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase">Supplier Invoice Number *</label>
                <Input
                  value={invoiceNumber}
                  onChange={e => { setInvoiceNumber(e.target.value); setDuplicateInvoice(null); }}
                  placeholder="e.g. INV-2024-001"
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase">Invoice Date</label>
                <Input
                  type="date"
                  value={invoiceDate}
                  onChange={e => { setInvoiceDate(e.target.value); setDueDateOverridden(false); }}
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase">
                  Due Date
                  {dueDate && !dueDateOverridden && <span className="ml-1 font-normal normal-case text-green-600">auto-calculated</span>}
                  {dueDateOverridden && <span className="ml-1 font-normal normal-case text-amber-600">manually set</span>}
                </label>
                <Input
                  type="date"
                  value={dueDate}
                  onChange={e => handleDueDateOverride(e.target.value)}
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase">Notes</label>
                <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Reason for blind receipt, driver name, etc." className="mt-1" />
              </div>
            </div>
          )}

          {/* Line items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-semibold">
                {isBlindReceipt ? 'Items Received' : 'Line Items'}
              </h4>
              <Button variant="outline" size="sm" onClick={addLine} className="gap-1">
                <Plus className="w-3.5 h-3.5" /> Add Line
              </Button>
            </div>
            <div className="border border-border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/50 border-b border-border">
                    <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Product</th>
                    <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase w-28">
                      {isBlindReceipt ? 'Qty Received' : 'Qty'}
                    </th>
                    <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase w-32">Unit Cost (excl. VAT)</th>
                    <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase w-28">Total</th>
                    <th className="w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {lines.map((line, idx) => {
                    const lt = (Number(line.qty) || 0) * (Number(line.unit_cost) || 0);
                    const product = products.find(p => p.id === line.product_id);
                    const sp = spSearchMap[line.product_id];
                    const enteredCost = Number(line.unit_cost);
                    const lastPrice = sp?.lastPrice || 0;
                    const threshold = sp?.varianceThreshold || 0.1;
                    const hasVariance = line.product_id && line.unit_cost && lastPrice > 0 &&
                      Math.abs(enteredCost - lastPrice) / lastPrice > threshold;
                    const variancePct = lastPrice > 0 ? ((enteredCost - lastPrice) / lastPrice * 100).toFixed(1) : 0;
                    return (
                      <tr key={idx} className={hasVariance ? 'bg-amber-50 dark:bg-amber-950/20' : ''}>
                        <td className="px-3 py-2">
                          <SearchableSelect
                            value={line.product_id}
                            onValueChange={v => selectProduct(idx, v)}
                            placeholder="Select..."
                            searchPlaceholder={isLoadingSPs ? 'Loading...' : 'Search...'}
                            disabled={isLoadingSPs}
                            triggerClassName="h-8 text-xs"
                            contentClassName="w-[420px]"
                            options={scopedProducts.map(p => {
                              const sp = spByProductId[p.id];
                              const ssp = spSearchMap[p.id];
                              const uom = sp?.purchase_uom_label || sp?.purchase_uom || p.purchase_uom || p.stock_uom || '';
                              return {
                                value: p.id,
                                label: `${p.sku} ${sp?.supplier_description || p.name}`,
                                keywords: [p.sku, p.name, ssp?.supplierSku || '', ssp?.supplierDesc || ''],
                                node: (
                                  <span className="truncate text-xs">
                                    <span className="font-mono text-muted-foreground">{p.sku}</span>
                                    {' — '}
                                    {sp?.supplier_description
                                      ? <><span className="font-medium">{sp.supplier_description}</span><span className="text-muted-foreground"> / {p.name}</span></>
                                      : p.name}
                                    {uom && <span className="text-muted-foreground"> · {uom}</span>}
                                  </span>
                                ),
                              };
                            })}
                          />
                          {product && (
                            <p className="text-[10px] text-muted-foreground mt-0.5">
                              {spByProductId[line.product_id]?.purchase_uom_label || product.purchase_uom || product.stock_uom || ''}
                            </p>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <Input type="number" value={line.qty} onChange={e => updateLine(idx, 'qty', e.target.value)} placeholder="0" className="h-9 text-sm bg-background" min="0" />
                        </td>
                        <td className="px-3 py-2">
                          <div className="relative">
                            <Input
                              type="number"
                              value={line.unit_cost}
                              onChange={e => updateLine(idx, 'unit_cost', e.target.value)}
                              placeholder="0.00"
                              className={`h-9 text-sm bg-background${hasVariance ? ' border-amber-400 focus:border-amber-500' : ''}`}
                              min="0"
                              step="0.01"
                            />
                            {hasVariance && (
                              <span className="absolute -top-5 left-0 text-[10px] text-amber-600 whitespace-nowrap font-medium">
                                {variancePct > 0 ? '+' : ''}{variancePct}% vs last (R{lastPrice.toFixed(2)})
                              </span>
                            )}
                          </div>
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
              <div className="flex justify-between"><span className="text-muted-foreground">VAT ({taxRatePct}%)</span><span>R {tax.toFixed(2)}</span></div>
              <div className="flex justify-between font-bold text-base pt-1 border-t border-border"><span>Total</span><span>R {total.toFixed(2)}</span></div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border shrink-0 flex gap-3">
          <Button variant="outline" className="flex-1" onClick={onCancel}>Cancel</Button>
          {isBlindReceipt ? (
            <Button className="flex-1 gap-2" onClick={() => handleCreate(false)} disabled={saving}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <PackageCheck className="w-4 h-4" />}
              Confirm Receipt & Update Stock
            </Button>
          ) : (
            <>
              <Button variant="secondary" className="flex-1 gap-2" onClick={() => handleCreate(true)} disabled={saving}>
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Save as Draft
              </Button>
              <Button className="flex-1 gap-2" onClick={() => handleCreate(false)} disabled={saving}>
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Approve PO
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
