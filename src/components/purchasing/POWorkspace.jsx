import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  ArrowLeft, Receipt, Loader2, Plus, Trash2, Save, CheckCircle2, Ban,
  AlertTriangle, CheckCheck,
} from 'lucide-react';
import { toast } from 'sonner';
import { nextDocNumber } from '@/lib/docNumbering';
import { resolveTaxRate, resolveTaxRateId, resolveTaxRateRecord } from '@/lib/taxResolution';
import { formatPaymentTerms } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------
const STATUS_COLORS = {
  draft: 'bg-gray-100 text-gray-600',
  approved: 'bg-blue-100 text-blue-700',
  confirmed: 'bg-blue-100 text-blue-700',
  partially_received: 'bg-amber-100 text-amber-700',
  received: 'bg-green-100 text-green-700',
  invoiced: 'bg-purple-100 text-purple-700',
  paid: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-600',
};

const STATUS_LABELS = {
  draft: 'Draft',
  approved: 'Approved',
  confirmed: 'Confirmed',
  partially_received: 'Partial Receipt',
  received: 'Received',
  invoiced: 'Invoiced',
  paid: 'Paid',
  cancelled: 'Cancelled',
};

const VIEW_ONLY_STATUSES = ['partially_received', 'received', 'invoiced', 'paid', 'cancelled'];

// ---------------------------------------------------------------------------
// Empty line factory
// ---------------------------------------------------------------------------
function emptyLine() {
  return {
    _key: Math.random().toString(36).slice(2),
    id: null,
    product_id: '',
    product_name: '',
    product_sku: '',
    supplier_sku: '',
    description: '',
    purchase_uom: '',
    ordered_qty: '',
    unit_cost: '',
    tax_rule: '',
    tax_rate: 0,
    tax_rate_id: null,
    line_total: 0,
    supplier_product_id: null,
    // Pending state: null | 'no_sp' | 'multi_sp'
    _pendingProductId: null,
    _spOptions: [],
  };
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export default function POWorkspace() {
  const { poId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isNew = poId === 'new';

  // ---- Reference data ----
  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers-active'],
    queryFn: () => base44.entities.Supplier.filter({ status: 'active' }, 'name', 200),
  });

  const { data: locations = [] } = useQuery({
    queryKey: ['locations'],
    queryFn: () => base44.entities.Location.filter({ is_stock_bearing: true }, 'name', 50),
  });

  const { data: products = [] } = useQuery({
    queryKey: ['products-active'],
    queryFn: () => base44.entities.Product.filter({ status: 'active' }, 'name', 500),
  });

  const { data: taxRates = [] } = useQuery({
    queryKey: ['tax-rates'],
    queryFn: () => base44.entities.TaxRate.filter({ active: true }, 'name', 20),
    staleTime: 300000,
  });

  // ---- PO data (edit mode) ----
  const { data: po, isLoading: isLoadingPO } = useQuery({
    queryKey: ['po', poId],
    queryFn: () => base44.entities.PurchaseOrder.filter({ id: poId }).then(r => r[0]),
    enabled: !isNew,
  });

  const { data: savedLines = [], isLoading: isLoadingLines } = useQuery({
    queryKey: ['po-lines', poId],
    queryFn: () => base44.entities.PurchaseOrderLine.filter({ purchase_order_id: poId }, 'created_date', 200),
    enabled: !isNew,
  });

  // ---- Local header state ----
  const [supplierId, setSupplierId] = useState('');
  const [orderDate, setOrderDate] = useState(new Date().toISOString().slice(0, 10));
  const [expectedDate, setExpectedDate] = useState('');
  const [locationId, setLocationId] = useState('');
  const [notes, setNotes] = useState('');

  // ---- Local lines state ----
  const [localLines, setLocalLines] = useState([emptyLine()]);

  // ---- UI state ----
  const [saving, setSaving] = useState(false);
  const [savedBanner, setSavedBanner] = useState(false);
  const [validationErrors, setValidationErrors] = useState([]);
  const [productSearch, setProductSearch] = useState('');

  // ---- Populate from loaded PO ----
  useEffect(() => {
    if (!po) return;
    setSupplierId(po.supplier_id || '');
    setOrderDate(po.order_date || new Date().toISOString().slice(0, 10));
    setExpectedDate(po.expected_date || '');
    setLocationId(po.location_id || '');
    setNotes(po.notes || '');
  }, [po]);

  useEffect(() => {
    if (!savedLines.length) return;
    setLocalLines(savedLines.map(l => ({
      _key: l.id,
      id: l.id,
      product_id: l.product_id || '',
      product_name: l.product_name || '',
      product_sku: l.product_sku || '',
      supplier_sku: l.supplier_sku || '',
      description: l.description || l.supplier_description || '',
      purchase_uom: l.purchase_uom || l.uom || '',
      ordered_qty: String(l.ordered_qty ?? ''),
      unit_cost: String(l.unit_cost ?? ''),
      tax_rule: l.tax_rule || '',
      tax_rate: l.tax_rate ?? 0,
      tax_rate_id: l.tax_rate_id || null,
      line_total: l.line_total ?? 0,
      supplier_product_id: l.supplier_product_id || null,
      _pendingProductId: null,
      _spOptions: [],
    })));
  }, [savedLines]);

  // ---- Derived ----
  const selectedSupplier = useMemo(() => suppliers.find(s => s.id === supplierId), [suppliers, supplierId]);

  const isViewOnly = useMemo(() => {
    if (isNew) return false;
    return po ? VIEW_ONLY_STATUSES.includes(po.status) : false;
  }, [isNew, po]);

  const currentStatus = isNew ? 'draft' : (po?.status || 'draft');

  // ---- Filtered products for search ----
  const filteredProducts = useMemo(() => {
    const q = productSearch.toLowerCase();
    if (!q) return products.slice(0, 20);
    return products.filter(p =>
      p.name?.toLowerCase().includes(q) ||
      (p.sku || '').toLowerCase().includes(q)
    ).slice(0, 25);
  }, [products, productSearch]);

  // ---- Line helpers ----
  const updateLine = useCallback((key, field, value) => {
    setLocalLines(prev => prev.map(l => l._key === key ? { ...l, [field]: value } : l));
  }, []);

  const removeLine = useCallback((key) => {
    setLocalLines(prev => prev.filter(l => l._key !== key));
  }, []);

  const addLine = () => setLocalLines(prev => [...prev, emptyLine()]);

  // When a product is selected on a pending row, look up SupplierProduct records
  const selectProduct = async (lineKey, productId) => {
    if (!productId) return;
    const product = products.find(p => p.id === productId);

    // Optimistically set product info
    setLocalLines(prev => prev.map(l => {
      if (l._key !== lineKey) return l;
      return {
        ...l,
        product_id: productId,
        product_name: product?.name || '',
        product_sku: product?.sku || '',
        _pendingProductId: productId,
        _spOptions: [],
      };
    }));

    if (!supplierId) {
      // No supplier yet — just set product, user will fill cost manually
      return;
    }

    try {
      const sps = await base44.entities.SupplierProduct.filter({
        supplier_id: supplierId,
        product_id: productId,
        active: true,
      });

      setLocalLines(prev => prev.map(l => {
        if (l._key !== lineKey) return l;

        if (sps.length === 0) {
          return {
            ...l,
            _pendingProductId: null,
            _spOptions: [],
            // Keep product set, but no auto-fill
          };
        }

        if (sps.length === 1) {
          const sp = sps[0];
          const taxRateRecord = resolveTaxRateRecord(sp, selectedSupplier, taxRates);
          const taxRateDecimal = taxRateRecord?.rate ?? 0;
          const unitCost = sp.nominal_cost || sp.last_purchase_price || 0;
          return {
            ...l,
            supplier_sku: sp.supplier_sku || '',
            description: sp.supplier_description || product?.name || '',
            purchase_uom: sp.purchase_uom_label || sp.purchase_uom || product?.stock_uom || '',
            unit_cost: unitCost > 0 ? String(unitCost) : l.unit_cost,
            tax_rule: taxRateRecord?.name || '',
            tax_rate: taxRateDecimal,
            tax_rate_id: taxRateRecord?.id || null,
            supplier_product_id: sp.id,
            _pendingProductId: null,
            _spOptions: [],
          };
        }

        // Multiple — show selector
        return {
          ...l,
          _pendingProductId: productId,
          _spOptions: sps,
        };
      }));
    } catch (err) {
      console.error('[POWorkspace] SupplierProduct lookup failed', err);
    }
  };

  const selectSupplierProduct = (lineKey, spId) => {
    setLocalLines(prev => prev.map(l => {
      if (l._key !== lineKey) return l;
      const sp = l._spOptions.find(s => s.id === spId);
      if (!sp) return l;
      const product = products.find(p => p.id === l.product_id);
      const taxRateRecord = resolveTaxRateRecord(sp, selectedSupplier, taxRates);
      const taxRateDecimal = taxRateRecord?.rate ?? 0;
      const unitCost = sp.nominal_cost || sp.last_purchase_price || 0;
      return {
        ...l,
        supplier_sku: sp.supplier_sku || '',
        description: sp.supplier_description || product?.name || '',
        purchase_uom: sp.purchase_uom_label || sp.purchase_uom || product?.stock_uom || '',
        unit_cost: unitCost > 0 ? String(unitCost) : l.unit_cost,
        tax_rule: taxRateRecord?.name || '',
        tax_rate: taxRateDecimal,
        tax_rate_id: taxRateRecord?.id || null,
        supplier_product_id: sp.id,
        _pendingProductId: null,
        _spOptions: [],
      };
    }));
  };

  // ---- Computed line totals ----
  const linesWithTotals = useMemo(() => localLines.map(l => {
    const qty = parseFloat(l.ordered_qty) || 0;
    const cost = parseFloat(l.unit_cost) || 0;
    const rate = parseFloat(l.tax_rate) || 0;
    const lineTotal = qty * cost * (1 + rate);
    return { ...l, _computedTotal: lineTotal };
  }), [localLines]);

  const subtotalExcl = useMemo(() =>
    linesWithTotals.reduce((s, l) => {
      const qty = parseFloat(l.ordered_qty) || 0;
      const cost = parseFloat(l.unit_cost) || 0;
      return s + qty * cost;
    }, 0), [linesWithTotals]);

  const totalVat = useMemo(() =>
    linesWithTotals.reduce((s, l) => {
      const qty = parseFloat(l.ordered_qty) || 0;
      const cost = parseFloat(l.unit_cost) || 0;
      const rate = parseFloat(l.tax_rate) || 0;
      return s + qty * cost * rate;
    }, 0), [linesWithTotals]);

  const totalIncl = subtotalExcl + totalVat;

  // ---- Approval validation ----
  const validateForApproval = () => {
    const errors = localLines.flatMap((line, i) => {
      if (!line.product_id) return [];
      const errs = [];
      if (!line.supplier_sku) errs.push(`Line ${i + 1}: Supplier SKU missing`);
      if (!line.purchase_uom) errs.push(`Line ${i + 1}: Purchase UOM missing`);
      if (!line.unit_cost || parseFloat(line.unit_cost) === 0) errs.push(`Line ${i + 1}: Unit cost missing`);
      if (!line.tax_rule) errs.push(`Line ${i + 1}: Tax rule missing`);
      return errs;
    });
    return errors;
  };

  // ---- Build PO header payload ----
  const buildHeaderPayload = () => ({
    supplier_id: supplierId,
    supplier_name: selectedSupplier?.name || '',
    location_id: locationId || null,
    order_date: orderDate,
    expected_date: expectedDate || null,
    notes: notes || null,
    subtotal: Math.round(subtotalExcl * 100) / 100,
    tax_amount: Math.round(totalVat * 100) / 100,
    total: Math.round(totalIncl * 100) / 100,
    currency: 'ZAR',
    payment_status: 'unpaid',
  });

  // ---- Build line payload ----
  const buildLinePayload = (l, purchaseOrderId) => {
    const product = products.find(p => p.id === l.product_id);
    const qty = parseFloat(l.ordered_qty) || 0;
    const unitCost = parseFloat(l.unit_cost) || 0;
    return {
      purchase_order_id: purchaseOrderId,
      product_id: l.product_id,
      product_name: l.product_name || product?.name || '',
      product_sku: l.product_sku || product?.sku || '',
      supplier_sku: l.supplier_sku || '',
      description: l.description || '',
      purchase_uom: l.purchase_uom || '',
      uom: l.purchase_uom || product?.stock_uom || 'pcs',
      ordered_qty: qty,
      received_qty: l.id ? undefined : 0,
      unit_cost: unitCost,
      tax_rule: l.tax_rule || '',
      tax_rate: parseFloat(l.tax_rate) || 0,
      tax_rate_id: l.tax_rate_id || null,
      supplier_product_id: l.supplier_product_id || null,
      line_total: Math.round(qty * unitCost * (1 + (parseFloat(l.tax_rate) || 0)) * 100) / 100,
    };
  };

  // ---- Show saved banner ----
  const showSavedBanner = () => {
    setSavedBanner(true);
    setTimeout(() => setSavedBanner(false), 3000);
  };

  // ---- Save ----
  const handleSave = async (targetStatus) => {
    if (!supplierId) { toast.error('Select a supplier'); return; }

    const validLines = localLines.filter(l => l.product_id && parseFloat(l.ordered_qty) > 0);
    if (validLines.length === 0) { toast.error('Add at least one line item'); return; }

    setSaving(true);
    try {
      if (isNew) {
        // Create PO
        const docNumber = await nextDocNumber('PO');
        const created = await base44.entities.PurchaseOrder.create({
          ...buildHeaderPayload(),
          po_number: docNumber,
          status: targetStatus || 'draft',
          type: 'formal_po',
        });

        // Create lines
        const linePayloads = validLines.map(l => buildLinePayload(l, created.id));
        if (linePayloads.length > 0) {
          await base44.entities.PurchaseOrderLine.bulkCreate(linePayloads);
        }

        queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
        toast.success(`${docNumber} created`);
        navigate(`/purchasing/purchase-orders/${created.id}`);
      } else {
        // Update PO header
        await base44.entities.PurchaseOrder.update(poId, {
          ...buildHeaderPayload(),
          ...(targetStatus ? { status: targetStatus } : {}),
        });

        // Upsert lines
        const existingIds = savedLines.map(l => l.id);
        const localIds = localLines.filter(l => l.id).map(l => l.id);

        // Delete removed lines
        for (const existingId of existingIds) {
          if (!localIds.includes(existingId)) {
            await base44.entities.PurchaseOrderLine.delete(existingId);
          }
        }

        // Update existing lines
        for (const l of validLines) {
          if (l.id) {
            const payload = buildLinePayload(l, poId);
            delete payload.received_qty; // never overwrite received qty on update
            await base44.entities.PurchaseOrderLine.update(l.id, payload);
          }
        }

        // Create new lines
        const newLines = validLines.filter(l => !l.id);
        if (newLines.length > 0) {
          const newPayloads = newLines.map(l => buildLinePayload(l, poId));
          await base44.entities.PurchaseOrderLine.bulkCreate(newPayloads);
        }

        queryClient.invalidateQueries({ queryKey: ['po', poId] });
        queryClient.invalidateQueries({ queryKey: ['po-lines', poId] });
        queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
        showSavedBanner();
      }
    } catch (err) {
      console.error('[POWorkspace] Save failed', err);
      toast.error(`Save failed: ${err.message || 'Unknown error'}`);
    } finally {
      setSaving(false);
    }
  };

  const handleApprove = async () => {
    const errors = validateForApproval();
    if (errors.length) {
      setValidationErrors(errors);
      return;
    }
    setValidationErrors([]);
    await handleSave('approved');
  };

  const handleCancelPO = async () => {
    if (isNew) { navigate('/purchasing/orders'); return; }
    setSaving(true);
    try {
      await base44.entities.PurchaseOrder.update(poId, { status: 'cancelled' });
      queryClient.invalidateQueries({ queryKey: ['po', poId] });
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      toast.success('PO cancelled');
    } catch (err) {
      toast.error(`Failed to cancel: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  // ---- Loading state ----
  if (!isNew && (isLoadingPO || isLoadingLines)) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const termsText = selectedSupplier?.payment_term_type
    ? formatPaymentTerms(selectedSupplier.payment_term_type, selectedSupplier.payment_term_value)
    : null;

  const canSave = !isViewOnly && (currentStatus === 'draft' || currentStatus === 'approved' || currentStatus === 'confirmed');
  const canApprove = !isViewOnly && currentStatus === 'draft';
  const canCancel = !isViewOnly && (currentStatus === 'draft' || currentStatus === 'approved' || currentStatus === 'confirmed');

  return (
    <div className="flex flex-col min-h-screen bg-background">
      {/* ================================================================== */}
      {/* Sticky top bar                                                      */}
      {/* ================================================================== */}
      <div className="sticky top-0 z-20 bg-card border-b border-border px-6 py-3 flex items-center gap-4 shadow-sm">
        <Button variant="ghost" size="sm" onClick={() => navigate('/purchasing/orders')} className="gap-1.5 text-muted-foreground">
          <ArrowLeft className="w-4 h-4" />
          Back
        </Button>

        <div className="flex items-center gap-2">
          <Receipt className="w-5 h-5 text-primary" />
          <span className="font-mono font-semibold text-base">
            {isNew ? 'New Purchase Order' : (po?.po_number || '...')}
          </span>
        </div>

        <Badge className={`text-[10px] ${STATUS_COLORS[currentStatus] || 'bg-gray-100 text-gray-600'}`}>
          {STATUS_LABELS[currentStatus] || currentStatus}
        </Badge>

        {savedBanner && (
          <span className="flex items-center gap-1 text-sm text-green-600 font-medium">
            <CheckCheck className="w-4 h-4" />
            Saved
          </span>
        )}

        <div className="ml-auto flex items-center gap-2">
          {canSave && (
            <Button variant="outline" size="sm" onClick={() => handleSave(null)} disabled={saving} className="gap-1.5">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save
            </Button>
          )}
          {canApprove && (
            <Button size="sm" onClick={handleApprove} disabled={saving} className="gap-1.5">
              <CheckCircle2 className="w-4 h-4" />
              Approve
            </Button>
          )}
          {canCancel && (
            <Button variant="outline" size="sm" onClick={handleCancelPO} disabled={saving}
              className="gap-1.5 text-destructive border-destructive/40 hover:bg-destructive/10">
              <Ban className="w-4 h-4" />
              Cancel PO
            </Button>
          )}
        </div>
      </div>

      {/* ================================================================== */}
      {/* Validation errors                                                   */}
      {/* ================================================================== */}
      {validationErrors.length > 0 && (
        <div className="mx-6 mt-4 rounded-lg bg-destructive/10 border border-destructive/30 p-4">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-destructive mb-1">Cannot approve — fix these issues first:</p>
              <ul className="list-disc list-inside space-y-0.5">
                {validationErrors.map((e, i) => (
                  <li key={i} className="text-xs text-destructive">{e}</li>
                ))}
              </ul>
            </div>
            <Button variant="ghost" size="icon" className="ml-auto h-6 w-6" onClick={() => setValidationErrors([])}>
              ×
            </Button>
          </div>
        </div>
      )}

      {/* ================================================================== */}
      {/* View-only banner                                                    */}
      {/* ================================================================== */}
      {isViewOnly && (
        <div className="mx-6 mt-4 rounded-lg bg-muted border border-border px-4 py-3 text-sm text-muted-foreground">
          This PO is <strong>{STATUS_LABELS[currentStatus]}</strong> and cannot be edited.
        </div>
      )}

      {/* ================================================================== */}
      {/* Main body                                                           */}
      {/* ================================================================== */}
      <div className="flex gap-6 px-6 py-6 flex-1 items-start">
        {/* ---- Left panel: Header fields ---- */}
        <div className="w-96 shrink-0 sticky top-[69px]">
          <div className="bg-card border border-border rounded-xl p-5 space-y-5">
            <h3 className="text-sm font-semibold text-foreground">Order Details</h3>

            {/* Supplier */}
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase block mb-1">
                Supplier *
              </label>
              {isViewOnly ? (
                <p className="text-sm font-medium">{po?.supplier_name || '—'}</p>
              ) : (
                <Select value={supplierId} onValueChange={setSupplierId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select supplier..." />
                  </SelectTrigger>
                  <SelectContent>
                    {suppliers.map(s => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {termsText && (
                <p className="text-[10px] text-muted-foreground mt-1">Payment terms: {termsText}</p>
              )}
            </div>

            {/* Order date */}
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase block mb-1">
                Order Date
              </label>
              {isViewOnly ? (
                <p className="text-sm">{po?.order_date || '—'}</p>
              ) : (
                <Input type="date" value={orderDate} onChange={e => setOrderDate(e.target.value)} />
              )}
            </div>

            {/* Expected delivery */}
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase block mb-1">
                Expected Delivery
              </label>
              {isViewOnly ? (
                <p className="text-sm">{po?.expected_date || '—'}</p>
              ) : (
                <Input type="date" value={expectedDate} onChange={e => setExpectedDate(e.target.value)} />
              )}
            </div>

            {/* Delivery location */}
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase block mb-1">
                Delivery Location
              </label>
              {isViewOnly ? (
                <p className="text-sm">
                  {locations.find(l => l.id === po?.location_id)?.name || '—'}
                </p>
              ) : (
                <Select value={locationId} onValueChange={setLocationId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select location..." />
                  </SelectTrigger>
                  <SelectContent>
                    {locations.map(l => (
                      <SelectItem key={l.id} value={l.id}>{l.name} ({l.code})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {/* Notes */}
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase block mb-1">
                Notes
              </label>
              {isViewOnly ? (
                <p className="text-sm text-muted-foreground">{po?.notes || '—'}</p>
              ) : (
                <Textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="Internal notes..."
                  rows={3}
                  className="resize-none"
                />
              )}
            </div>

            {/* Payment terms (read-only) */}
            {selectedSupplier?.payment_term_type && (
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase block mb-1">
                  Payment Terms
                </label>
                <p className="text-sm text-muted-foreground">{termsText}</p>
              </div>
            )}
          </div>
        </div>

        {/* ---- Right panel: Line items ---- */}
        <div className="flex-1 min-w-0 space-y-4">
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            {/* Table header row with Add Line button */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <h3 className="text-sm font-semibold">Line Items ({localLines.length})</h3>
              {!isViewOnly && (
                <Button variant="outline" size="sm" onClick={addLine} className="gap-1.5">
                  <Plus className="w-3.5 h-3.5" />
                  Add Line
                </Button>
              )}
            </div>

            {/* Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/50 border-b border-border">
                    <th className="text-left px-3 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase min-w-[180px]">Product</th>
                    <th className="text-left px-3 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase w-32">Supplier SKU</th>
                    <th className="text-left px-3 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase min-w-[140px]">Description</th>
                    <th className="text-left px-3 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase w-24">UOM</th>
                    <th className="text-right px-3 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase w-20">Qty</th>
                    <th className="text-right px-3 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase w-28">Unit Cost</th>
                    <th className="text-left px-3 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase w-28">Tax</th>
                    <th className="text-right px-3 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase w-28">Line Total</th>
                    {!isViewOnly && <th className="w-10"></th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {linesWithTotals.map((line, idx) => (
                    <LineRow
                      key={line._key}
                      line={line}
                      idx={idx}
                      isViewOnly={isViewOnly}
                      products={products}
                      filteredProducts={filteredProducts}
                      productSearch={productSearch}
                      setProductSearch={setProductSearch}
                      taxRates={taxRates}
                      supplierId={supplierId}
                      onUpdate={updateLine}
                      onRemove={removeLine}
                      onSelectProduct={selectProduct}
                      onSelectSupplierProduct={selectSupplierProduct}
                    />
                  ))}
                  {linesWithTotals.length === 0 && (
                    <tr>
                      <td colSpan={isViewOnly ? 8 : 9} className="px-4 py-8 text-center text-sm text-muted-foreground">
                        No line items. Click "+ Add Line" to begin.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* ---- Totals footer ---- */}
          <div className="bg-card border border-border rounded-xl p-5">
            <div className="max-w-xs ml-auto space-y-1.5">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Subtotal excl. VAT</span>
                <span className="font-medium">R {subtotalExcl.toLocaleString('en-ZA', { minimumFractionDigits: 2 })}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Total VAT</span>
                <span className="font-medium">R {totalVat.toLocaleString('en-ZA', { minimumFractionDigits: 2 })}</span>
              </div>
              <div className="flex justify-between text-base font-bold pt-1.5 border-t border-border">
                <span>Total incl. VAT</span>
                <span>R {totalIncl.toLocaleString('en-ZA', { minimumFractionDigits: 2 })}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// LineRow — extracted for clarity
// ---------------------------------------------------------------------------
function LineRow({
  line, idx, isViewOnly,
  products, filteredProducts, productSearch, setProductSearch,
  taxRates, supplierId,
  onUpdate, onRemove, onSelectProduct, onSelectSupplierProduct,
}) {
  const hasMultiSP = line._spOptions.length > 1;
  const hasNoSP = line._pendingProductId && line._spOptions.length === 0 && !line.supplier_sku;

  return (
    <tr className={`${hasNoSP ? 'bg-amber-50/60' : ''}`}>
      {/* Product */}
      <td className="px-3 py-2">
        {isViewOnly ? (
          <div>
            <p className="text-xs font-medium">{line.product_name}</p>
            <p className="text-[10px] font-mono text-muted-foreground">{line.product_sku}</p>
          </div>
        ) : line.product_id ? (
          <div>
            <p className="text-xs font-medium">{line.product_name}</p>
            <p className="text-[10px] font-mono text-muted-foreground">{line.product_sku}</p>
            {hasNoSP && supplierId && (
              <p className="text-[10px] text-amber-700 mt-0.5 flex items-center gap-0.5">
                <AlertTriangle className="w-3 h-3" />
                No supplier purchase option found. Create one in Supplier Catalog first.
              </p>
            )}
            {hasMultiSP && (
              <div className="mt-1">
                <Select onValueChange={v => onSelectSupplierProduct(line._key, v)}>
                  <SelectTrigger className="h-7 text-xs">
                    <SelectValue placeholder="Select purchase option..." />
                  </SelectTrigger>
                  <SelectContent>
                    {line._spOptions.map(sp => (
                      <SelectItem key={sp.id} value={sp.id}>
                        {sp.purchase_uom_label || sp.purchase_uom}
                        {sp.nominal_cost ? ` @ R${Number(sp.nominal_cost).toFixed(2)}` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        ) : (
          <Select
            value={line.product_id}
            onValueChange={v => onSelectProduct(line._key, v)}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Select product..." />
            </SelectTrigger>
            <SelectContent>
              <div className="px-2 pb-2 pt-1">
                <Input
                  placeholder="Search products..."
                  value={productSearch}
                  onChange={e => setProductSearch(e.target.value)}
                  className="h-7 text-xs"
                />
              </div>
              {filteredProducts.map(p => (
                <SelectItem key={p.id} value={p.id}>
                  <span className="font-mono text-xs text-muted-foreground">{p.sku}</span>
                  {' — '}
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </td>

      {/* Supplier SKU */}
      <td className="px-3 py-2">
        {isViewOnly ? (
          <span className="text-xs font-mono">{line.supplier_sku || '—'}</span>
        ) : (
          <Input
            value={line.supplier_sku}
            onChange={e => onUpdate(line._key, 'supplier_sku', e.target.value)}
            placeholder="SKU..."
            className="h-8 text-xs"
          />
        )}
      </td>

      {/* Description */}
      <td className="px-3 py-2">
        {isViewOnly ? (
          <span className="text-xs">{line.description || '—'}</span>
        ) : (
          <Input
            value={line.description}
            onChange={e => onUpdate(line._key, 'description', e.target.value)}
            placeholder="Description..."
            className="h-8 text-xs"
          />
        )}
      </td>

      {/* Purchase UOM */}
      <td className="px-3 py-2">
        {isViewOnly ? (
          <span className="text-xs">{line.purchase_uom || '—'}</span>
        ) : (
          <Input
            value={line.purchase_uom}
            onChange={e => onUpdate(line._key, 'purchase_uom', e.target.value)}
            placeholder="e.g. box"
            className="h-8 text-xs"
          />
        )}
      </td>

      {/* Qty */}
      <td className="px-3 py-2">
        {isViewOnly ? (
          <span className="text-xs text-right block">{line.ordered_qty}</span>
        ) : (
          <Input
            type="number"
            value={line.ordered_qty}
            onChange={e => onUpdate(line._key, 'ordered_qty', e.target.value)}
            placeholder="0"
            min="0"
            className="h-8 text-xs text-right"
          />
        )}
      </td>

      {/* Unit Cost */}
      <td className="px-3 py-2">
        {isViewOnly ? (
          <span className="text-xs text-right block">
            {line.unit_cost ? `R ${Number(line.unit_cost).toFixed(2)}` : '—'}
          </span>
        ) : (
          <Input
            type="number"
            value={line.unit_cost}
            onChange={e => onUpdate(line._key, 'unit_cost', e.target.value)}
            placeholder="0.00"
            min="0"
            step="0.01"
            className="h-8 text-xs text-right"
          />
        )}
      </td>

      {/* Tax */}
      <td className="px-3 py-2">
        {isViewOnly ? (
          <span className="text-xs">{line.tax_rule || '—'}</span>
        ) : (
          <Select
            value={line.tax_rate_id || '__none__'}
            onValueChange={v => {
              if (v === '__none__') {
                onUpdate(line._key, 'tax_rate_id', null);
                onUpdate(line._key, 'tax_rate', 0);
                onUpdate(line._key, 'tax_rule', '');
              } else {
                const tr = taxRates.find(r => r.id === v);
                onUpdate(line._key, 'tax_rate_id', v);
                onUpdate(line._key, 'tax_rate', tr?.rate ?? 0);
                onUpdate(line._key, 'tax_rule', tr?.name || '');
              }
            }}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Tax..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">No tax</SelectItem>
              {taxRates.map(tr => (
                <SelectItem key={tr.id} value={tr.id}>
                  {tr.name} ({Math.round((tr.rate || 0) * 100)}%)
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </td>

      {/* Line Total */}
      <td className="px-3 py-2 text-right whitespace-nowrap">
        <span className="text-sm font-medium">
          {line._computedTotal > 0
            ? `R ${line._computedTotal.toLocaleString('en-ZA', { minimumFractionDigits: 2 })}`
            : '—'}
        </span>
      </td>

      {/* Delete */}
      {!isViewOnly && (
        <td className="px-3 py-2 text-center">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onRemove(line._key)}
            className="h-7 w-7 text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </td>
      )}
    </tr>
  );
}
