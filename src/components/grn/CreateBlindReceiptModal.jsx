import React, { useState, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44, supabase } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SearchableSelect } from '@/components/ui/SearchableSelect';
import { X, Plus, Trash2, Loader2, PackageCheck, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { confirmGRN, finaliseGRNWithDecisions } from './GRNConfirmLogic';
import ShortReceivalDecisionModal from './ShortReceivalDecisionModal';
import { useAuth } from '@/lib/AuthContext';
import { nextDocNumber } from '@/lib/docNumbering';
import { calculateDueDate, formatPaymentTerms, toISODate } from '@/lib/utils';
import { resolveTaxRate } from '@/lib/taxResolution';
import SupplierInfoBlock from '@/components/purchasing/SupplierInfoBlock';
import { useUnsavedChanges, useGuardedAction } from '@/lib/navigationGuard';

const emptyLine = () => ({ product_id: '', invoiced_qty: '', received_qty: '', unit_cost: '', uom: '', supplier_product_id: '' });

// Effective received qty: blank means "received exactly what was invoiced".
const recvOf = (l) => (l.received_qty === '' || l.received_qty == null)
  ? (Number(l.invoiced_qty) || 0)
  : (Number(l.received_qty) || 0);

export default function CreateBlindReceiptModal({ onCreated, onCancel, prefill }) {
  const { user } = useAuth();
  const userName = user?.full_name || user?.email || 'System';
  const [saving, setSaving] = useState(false);
  const [supplierId, setSupplierId] = useState(prefill?.supplier_id || '');
  const [locationId, setLocationId] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState(prefill?.invoice_number || '');
  const [invoiceDate, setInvoiceDate] = useState(prefill?.invoice_date || new Date().toISOString().slice(0, 10));
  // A scanned explicit due date is treated as an override so the supplier-terms
  // auto-calc doesn't overwrite it; a terms-derived prefill leaves it recomputable.
  const [dueDate, setDueDate] = useState(prefill?.due_date || '');
  const [dueDateOverridden, setDueDateOverridden] = useState(!!prefill?.due_date_overridden);
  const [notes, setNotes] = useState(prefill?.notes || '');
  const [lines, setLines] = useState(
    prefill?.lines?.length
      ? prefill.lines.map(l => ({ ...emptyLine(), ...l }))
      : [emptyLine()],
  );
  const [duplicateInvoice, setDuplicateInvoice] = useState(null);
  // When confirmGRN short-receives, it pauses here for per-line decisions.
  const [pendingDecision, setPendingDecision] = useState(null); // { result, po, grn }

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

  const { data: taxRates = [] } = useQuery({
    queryKey: ['tax-rates'],
    queryFn: () => base44.entities.TaxRate.filter({ active: true }, 'name', 20),
    staleTime: 300000,
  });

  const selectedSupplier = useMemo(() => suppliers.find(s => s.id === supplierId), [suppliers, supplierId]);

  // Auto-calculate due date when supplier or invoiceDate changes
  useEffect(() => {
    if (dueDateOverridden) return;
    if (!selectedSupplier?.payment_term_type || !invoiceDate) {
      setDueDate('');
      return;
    }
    const calculated = calculateDueDate(invoiceDate, selectedSupplier.payment_term_type, selectedSupplier.payment_term_value);
    setDueDate(calculated ? toISODate(calculated) : '');
  }, [supplierId, invoiceDate, dueDateOverridden, selectedSupplier]);

  const spByProductId = useMemo(() => {
    const map = {};
    supplierProducts.forEach(sp => { map[sp.product_id] = sp; });
    return map;
  }, [supplierProducts]);

  // Supplier-scoped product list (no search filter, no render cap — the
  // SearchableSelect handles type-to-search internally over the full list).
  const scopedProducts = useMemo(() => {
    if (supplierId && supplierProducts.length > 0) {
      const spIds = new Set(supplierProducts.map(sp => sp.product_id));
      return products.filter(p => spIds.has(p.id));
    }
    return products;
  }, [products, supplierId, supplierProducts]);

  const productOptions = useMemo(() => scopedProducts.map(p => {
    const sp = spByProductId[p.id];
    return {
      value: p.id,
      label: `${p.sku || ''} ${sp?.supplier_description || ''} ${p.name}`.trim(),
      keywords: [p.sku, p.name, sp?.supplier_sku, sp?.supplier_description].filter(Boolean),
      node: (
        <span className="truncate">
          <span className="font-mono text-xs text-muted-foreground">{p.sku}</span>
          {' — '}
          {sp?.supplier_description ? (
            <><span className="font-medium">{sp.supplier_description}</span><span className="text-muted-foreground"> / {p.name}</span></>
          ) : p.name}
          {sp?.last_purchase_price > 0 && <span className="text-muted-foreground"> @ R{Number(sp.last_purchase_price).toFixed(2)}</span>}
        </span>
      ),
    };
  }), [scopedProducts, spByProductId]);

  const addLine = () => setLines(prev => [...prev, emptyLine()]);
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

  const poTaxRate = useMemo(() => resolveTaxRate(null, selectedSupplier, taxRates), [selectedSupplier, taxRates]);

  // Invoice value is what the supplier billed → invoiced_qty × cost. Stock value
  // (handled inside confirmGRN) is driven by the received qty instead.
  const validLines = lines.filter(l => l.product_id && Number(l.invoiced_qty) > 0 && Number(l.unit_cost) >= 0);
  const subtotal = validLines.reduce((s, l) => s + (Number(l.invoiced_qty) * Number(l.unit_cost)), 0);
  const tax = Math.round(subtotal * poTaxRate * 100) / 100;
  const total = subtotal + tax;
  const anyShort = validLines.some(l => recvOf(l) < Number(l.invoiced_qty));

  // Unsaved-changes guard: dirty once a header field is set or any line has
  // a product / qty / cost entered. Invoice date defaults to today.
  const dirty =
    !!supplierId ||
    !!locationId ||
    !!invoiceNumber ||
    !!notes ||
    lines.some(l => l.product_id || l.invoiced_qty || l.received_qty || l.unit_cost);
  useUnsavedChanges(saving ? false : dirty, { message: 'This blind receipt has unsaved changes.' });
  const guardedClose = useGuardedAction();

  const checkDuplicateInvoice = async () => {
    if (!invoiceNumber || !supplierId) return null;
    const existing = await base44.entities.PurchaseInvoice.filter({
      supplier_id: supplierId,
      invoice_number: invoiceNumber,
    });
    return existing[0] || null;
  };

  // Create the supplier invoice (header + lines) once the GRN is settled, then finish.
  const createInvoiceAndFinish = async (po, grn) => {
    const supplier = suppliers.find(s => s.id === supplierId);
    const invoice = await base44.entities.PurchaseInvoice.create({
      invoice_number: invoiceNumber.trim(),
      supplier_id: supplierId,
      supplier_name: supplier?.name || '',
      purchase_order_id: po.id,
      grn_id: grn.id,
      invoice_date: invoiceDate,
      due_date_calculated: dueDate || null,
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

    for (const l of validLines) {
      const invoicedQty = Number(l.invoiced_qty) || 0;
      const receivedQty = recvOf(l);
      const cost = Number(l.unit_cost) || 0;
      const product = products.find(p => p.id === l.product_id);
      await base44.entities.PurchaseInvoiceLine.create({
        invoice_id: invoice.id,
        po_line_id: l._poLineId || null,
        product_id: l.product_id,
        product_name: product?.name || '',
        product_sku: product?.sku || '',
        supplier_product_id: l.supplier_product_id || null,
        ordered_qty: invoicedQty,
        received_qty: receivedQty,
        qty: invoicedQty,                  // the supplier billed this much
        qty_variance: invoicedQty - receivedQty,
        unit_cost: cost,
        tax_rule: '',
        tax_rate: poTaxRate,
        line_total: Math.round(invoicedQty * cost * 100) / 100,
        match_status: 'manually_matched',
      });
    }

    // Stamp the expected invoice number on the PO (mirrors linkInvoiceToPO).
    try { await base44.entities.PurchaseOrder.update(po.id, { supplier_invoice_number: invoiceNumber.trim() }); } catch (_) {}

    // When this receipt came from a scanned invoice, archive the original
    // document against the invoice so it shows on the Attachments tab — same
    // place native scans / Xero PDFs land. Non-fatal.
    if (prefill?.scannedFile) {
      try {
        const f = prefill.scannedFile;
        const ext = (f.name?.split('.').pop() || 'pdf').toLowerCase();
        const path = `native/${invoice.id}/${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from('purchase-documents')
          .upload(path, f, { contentType: f.type || 'application/octet-stream', upsert: true });
        if (!upErr) {
          const { data: pub } = supabase.storage.from('purchase-documents').getPublicUrl(path);
          await base44.entities.PurchaseAttachment.create({
            invoice_id: invoice.id,
            source: 'native',
            file_name: f.name || `scan.${ext}`,
            file_path: path,
            file_url: pub?.publicUrl || null,
            mime_type: f.type || null,
            size_bytes: f.size || null,
          });
        }
      } catch { /* non-fatal — invoice is already saved */ }
    }

    toast.success(`Blind receipt ${grn.grn_number} confirmed — stock updated`);
    onCreated(po);
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
      const [brNumber, grnNumber] = await Promise.all([
        nextDocNumber('BR'),
        nextDocNumber('GRN'),
      ]);

      // 1. Create blind PO (status set by confirmGRN / finalise afterwards)
      const po = await base44.entities.PurchaseOrder.create({
        po_number: brNumber,
        supplier_id: supplierId,
        supplier_name: supplier?.name || '',
        location_id: locationId,
        // Stays 'approved' until confirmGRN / finalise advances it — so a failure
        // mid-flow doesn't leave a PO that looks fully received (and re-invoiceable).
        status: 'approved',
        type: 'blind_receipt',
        order_date: today,
        expected_date: today,
        subtotal: Math.round(subtotal * 100) / 100,
        tax_amount: tax,
        total: Math.round(total * 100) / 100,
        currency: 'ZAR',
        payment_status: 'unpaid',
        due_date_calculated: dueDate || null,
        due_date_overridden: dueDateOverridden,
        notes: notes || null,
      });

      // 2. Create PO lines individually so we can key GRN lines to po_line_id
      //    (needed for shortage records). ordered = invoiced, received = accepted.
      for (const l of validLines) {
        const product = products.find(p => p.id === l.product_id);
        const invoicedQty = Number(l.invoiced_qty) || 0;
        const receivedQty = recvOf(l);
        const unitCost = Number(l.unit_cost) || 0;
        const poLine = await base44.entities.PurchaseOrderLine.create({
          purchase_order_id: po.id,
          product_id: l.product_id,
          product_name: product?.name || '',
          product_sku: product?.sku || '',
          supplier_product_id: l.supplier_product_id || null,
          ordered_qty: invoicedQty,
          received_qty: receivedQty,
          unit_cost: unitCost,
          uom: l.uom || product?.stock_uom || 'pcs',
          line_total: Math.round(invoicedQty * unitCost * 100) / 100,
        });
        l._poLineId = poLine.id; // stash for invoice line linking
      }

      // 3. Create GRN (draft → confirmed by confirmGRN)
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

      // 4. Build GRN lines — expected = invoiced, received = accepted. A short
      //    receival (received < invoiced) makes variance_qty negative, which
      //    triggers confirmGRN's decision flow.
      const grnLines = validLines.map(l => {
        const product = products.find(p => p.id === l.product_id);
        const sp = spByProductId[l.product_id];
        const invoicedQty = Number(l.invoiced_qty) || 0;
        const receivedQty = recvOf(l);
        const unitCost = Number(l.unit_cost) || 0;
        const cf = sp?.conversion_factor || sp?.purchase_to_stock_factor || 1;
        return {
          grn_id: grn.id,
          po_line_id: l._poLineId || null,
          product_id: l.product_id,
          product_name: product?.name || '',
          product_sku: product?.sku || '',
          supplier_product_id: l.supplier_product_id || null,
          expected_qty: invoicedQty,
          received_qty: receivedQty,
          unit_cost: unitCost,
          purchase_uom: l.uom || '',
          conversion_factor: cf,
          yield_factor: 1,
          condition: 'accepted',
          item_type: 'stock',
        };
      });

      // 5. Confirm GRN (moves stock for received qty, lays cost layers).
      const result = await confirmGRN(grn, grnLines, userName);

      // Short-received lines → pause for per-line decisions, then create invoice.
      if (result?.requiresDecision) {
        setPendingDecision({ result, po, grn });
        setSaving(false);
        return;
      }

      // 6. No shortage → create the invoice and finish.
      await createInvoiceAndFinish(po, grn);
    } catch (err) {
      console.error('[CreateBlindReceiptModal]', err);
      toast.error(`Failed: ${err.message || 'Unknown error'}`);
      setSaving(false);
    }
  };

  const handleDecisionsConfirmed = async (decisions) => {
    if (!pendingDecision) return;
    setSaving(true);
    try {
      await finaliseGRNWithDecisions(
        pendingDecision.result.grn,
        pendingDecision.result.persistedLines,
        decisions,
        userName,
      );
      await createInvoiceAndFinish(pendingDecision.po, pendingDecision.grn);
      setPendingDecision(null);
    } catch (err) {
      console.error('[CreateBlindReceiptModal] finalise', err);
      toast.error(`Failed to finalise: ${err.message || 'Unknown error'}`);
      setSaving(false);
    }
  };

  // confirmGRN has ALREADY moved stock by the time the decision modal shows, so
  // "cancel" must not orphan a draft GRN with unrecorded shortages. Instead we
  // finalise with every short line flagged 'review' — a safe, consistent state
  // (GRN confirmed, shortages queued for review) the user can resolve later.
  const handleDecisionsCancelled = async () => {
    if (!pendingDecision) return;
    setSaving(true);
    try {
      const reviewDecisions = {};
      (pendingDecision.result.shortLines || []).forEach((l) => { if (l.id) reviewDecisions[l.id] = { action: 'review' }; });
      await finaliseGRNWithDecisions(
        pendingDecision.result.grn,
        pendingDecision.result.persistedLines,
        reviewDecisions,
        userName,
      );
      await createInvoiceAndFinish(pendingDecision.po, pendingDecision.grn);
      setPendingDecision(null);
      toast.warning('Short lines flagged for review — resolve them in Shortages / Credits & Returns.');
    } catch (err) {
      console.error('[CreateBlindReceiptModal] cancel-finalise', err);
      toast.error(`Failed to finalise: ${err.message || 'Unknown error'}`);
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
          <Button variant="ghost" size="icon" onClick={() => guardedClose(onCancel)}><X className="w-5 h-5" /></Button>
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
              <SearchableSelect
                value={supplierId}
                onValueChange={v => { setSupplierId(v); setLines([emptyLine()]); }}
                options={suppliers.map(s => ({ value: s.id, label: s.name }))}
                placeholder="Select supplier..."
                searchPlaceholder="Search suppliers..."
                triggerClassName="mt-1"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase">Deliver To *</label>
              <SearchableSelect
                value={locationId}
                onValueChange={setLocationId}
                options={locations.map(l => ({ value: l.id, label: `${l.name} (${l.code})` }))}
                placeholder="Select location..."
                searchPlaceholder="Search locations..."
                triggerClassName="mt-1"
              />
            </div>
          </div>

          {selectedSupplier && <SupplierInfoBlock supplier={selectedSupplier} />}

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

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase">Due Date</label>
              <div className="flex gap-2 mt-1">
                <Input
                  type="date"
                  value={dueDate}
                  onChange={e => { setDueDate(e.target.value); setDueDateOverridden(true); }}
                  className="flex-1"
                />
                {dueDateOverridden && (
                  <Button variant="ghost" size="sm" className="text-xs text-muted-foreground" onClick={() => { setDueDateOverridden(false); }}>
                    Reset
                  </Button>
                )}
              </div>
              {selectedSupplier?.payment_term_type && !dueDateOverridden && (
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  Auto: {formatPaymentTerms(selectedSupplier.payment_term_type, selectedSupplier.payment_term_value)}
                </p>
              )}
            </div>
            <div />
          </div>

          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase">Notes</label>
            <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Reason for blind receipt, driver name, etc." className="mt-1" />
          </div>

          {/* Line items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-semibold">Items</h4>
              <Button variant="outline" size="sm" onClick={addLine} className="gap-1"><Plus className="w-3.5 h-3.5" /> Add Line</Button>
            </div>
            <p className="text-[11px] text-muted-foreground mb-2">
              <strong>Invoiced</strong> = what the supplier billed. <strong>Received</strong> = what actually arrived in good condition
              (leave blank if it equals invoiced). If you received less than invoiced, you'll be asked to await the rest, request a credit, or split.
            </p>
            <div className="border border-border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/50 border-b border-border">
                    <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Product</th>
                    <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase w-24">Qty Invoiced</th>
                    <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase w-24">Qty Received</th>
                    <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase w-32">Unit Cost (excl. VAT)</th>
                    <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase w-28">Line Total</th>
                    <th className="w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {lines.map((line, idx) => {
                    const invoicedQty = Number(line.invoiced_qty) || 0;
                    const receivedQty = recvOf(line);
                    const short = line.product_id && invoicedQty > 0 && receivedQty < invoicedQty;
                    const lt = invoicedQty * (Number(line.unit_cost) || 0);
                    const product = products.find(p => p.id === line.product_id);
                    return (
                      <tr key={idx}>
                        <td className="px-3 py-2">
                          <SearchableSelect
                            value={line.product_id}
                            onValueChange={v => selectProduct(idx, v)}
                            options={productOptions}
                            placeholder="Select product..."
                            searchPlaceholder={isLoadingSPs ? 'Loading...' : 'Search...'}
                            triggerClassName="h-8 text-xs"
                            contentClassName="w-[420px]"
                          />
                          {product && (
                            <p className="text-[10px] text-muted-foreground mt-0.5">
                              {line.uom || spByProductId[line.product_id]?.purchase_uom_label || product.purchase_uom || product.stock_uom || ''}
                            </p>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <Input type="number" value={line.invoiced_qty} onChange={e => updateLine(idx, 'invoiced_qty', e.target.value)} placeholder="0" className="h-9 text-sm bg-background" min="0" />
                        </td>
                        <td className="px-3 py-2">
                          <Input
                            type="number"
                            value={line.received_qty}
                            onChange={e => updateLine(idx, 'received_qty', e.target.value)}
                            placeholder={line.invoiced_qty || '0'}
                            className={`h-9 text-sm bg-background ${short ? 'border-amber-400 text-amber-700' : ''}`}
                            min="0"
                          />
                          {short && <p className="text-[10px] text-amber-600 mt-0.5">{(invoicedQty - receivedQty)} short</p>}
                        </td>
                        <td className="px-3 py-2">
                          <Input type="number" value={line.unit_cost} onChange={e => updateLine(idx, 'unit_cost', e.target.value)} placeholder="0.00" className="h-9 text-sm bg-background" min="0" step="0.01" />
                        </td>
                        <td className="px-3 py-2 text-right text-sm font-medium whitespace-nowrap">
                          {lt > 0 ? `R ${lt.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
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
              {anyShort && (
                <div className="flex items-start gap-2 text-amber-700 text-xs pb-1">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>Some lines were received short. The invoice records the invoiced quantity; only the received quantity is added to stock, and you'll choose how to handle the difference.</span>
                </div>
              )}
              <div className="flex justify-between"><span className="text-muted-foreground">Invoice subtotal</span><span>R {subtotal.toFixed(2)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">VAT ({Math.round(poTaxRate * 100)}%)</span><span>R {tax.toFixed(2)}</span></div>
              <div className="flex justify-between font-bold text-base pt-1 border-t border-border"><span>Invoice Total</span><span>R {total.toFixed(2)}</span></div>
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

      {pendingDecision && (
        <ShortReceivalDecisionModal
          grn={pendingDecision.grn}
          shortLines={pendingDecision.result.shortLines}
          onConfirm={handleDecisionsConfirmed}
          onCancel={handleDecisionsCancelled}
        />
      )}
    </div>
  );
}
