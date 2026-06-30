import React, { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44, supabase } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { SearchableSelect } from '@/components/ui/SearchableSelect';
import PurchasingUnitFields from '@/components/shared/PurchasingUnitFields';
import CreateBlindReceiptModal from '@/components/grn/CreateBlindReceiptModal';
import CreateProductFromLineModal from '@/components/review-queue/CreateProductFromLineModal';
import { calculateDueDate, formatPaymentTerms, toISODate } from '@/lib/utils';
import { parsePack } from '@/lib/purchasingUnit';
import {
  X, Upload, Loader2, ScanLine, CheckCircle2, AlertCircle, FileText,
  Package, Unlink, PackageCheck, Settings2, Check, Plus, Save,
} from 'lucide-react';
import { toast } from 'sonner';

// Sentinel option value used by the line picker to trigger "create a new product".
const ADD_NEW = '__add_new__';

const STEP_UPLOAD   = 'upload';
const STEP_REVIEW   = 'review';
const STEP_SAVING   = 'saving';
const STEP_DONE     = 'done';

function normalise(str) {
  return (str || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function autoMatch(description, products) {
  const q = normalise(description);
  if (!q) return null;
  // Exact SKU match first
  const bySku = products.find(p => normalise(p.sku) === q);
  if (bySku) return bySku.id;
  // Contains match on name
  let best = null;
  let bestScore = 0;
  for (const p of products) {
    const name = normalise(p.name);
    if (name.includes(q) || q.includes(name)) {
      const score = Math.min(q.length, name.length) / Math.max(q.length, name.length);
      if (score > bestScore) { bestScore = score; best = p.id; }
    }
  }
  return bestScore > 0.5 ? best : null;
}

// Seed a purchasing-unit form for a freshly-linked line. Pull a best-guess pack
// from the invoice line text (e.g. "10 × 2kg", "25kg", "per kg"); otherwise
// default to a 1:1 single unit the user can adjust.
function seedUnitForm(line, product) {
  const guess = parsePack(`${line?.description || ''} ${line?.unit || ''}`);
  const stockUom = (product?.stock_uom || 'each').toLowerCase();
  return {
    purchase_uom: line?.unit || product?.purchase_uom || '',
    pack_size: guess?.packSize != null ? String(guess.packSize) : '1',
    pack_size_uom: guess?.packSizeUom || stockUom,
    pack_qty: guess?.packQty != null ? String(guess.packQty) : '1',
    conversion_factor: '',
  };
}

// Two destinations for an uploaded invoice, chosen up-front:
//  • 'invoice' — save a live AP invoice to be matched to an open PO / GRN later
//  • 'blind'   — no PO; receive the stock directly via the blind-receipt engine
const MODE_INVOICE = 'invoice';
const MODE_BLIND   = 'blind';

function ModeToggle({ mode, onChange, disabled }) {
  const opt = (value, label) => (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(value)}
      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors disabled:opacity-50 ${
        mode === value ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      {label}
    </button>
  );
  return (
    <div className="inline-flex rounded-lg border border-border p-0.5 bg-muted/40">
      {opt(MODE_INVOICE, 'Invoice (match to PO/GRN)')}
      {opt(MODE_BLIND, 'Blind receipt')}
    </div>
  );
}

export default function InvoiceScanDialog({ onClose, onSaved, preselectedSupplierId, initialMode = MODE_INVOICE, resumeDraft = null }) {
  const rd = resumeDraft;
  const queryClient = useQueryClient();
  const fileInputRef = useRef(null);
  const [step, setStep] = useState(rd ? STEP_REVIEW : STEP_UPLOAD);
  const [mode, setMode] = useState(
    (rd?.mode === MODE_BLIND || (!rd && initialMode === MODE_BLIND)) ? MODE_BLIND : MODE_INVOICE,
  );
  const [dragOver, setDragOver] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState(null);
  const [preparing, setPreparing] = useState(false);

  // Extracted invoice data
  const [extracted, setExtracted] = useState(rd?.extracted || null);
  // Original uploaded file — archived to the purchase-documents bucket on save.
  const [scannedFile, setScannedFile] = useState(null);
  // Stored file metadata (set on draft save / resume) so re-saving keeps the file.
  const [draftFileMeta, setDraftFileMeta] = useState(rd?.file_path ? {
    file_name: rd.file_name, file_path: rd.file_path, file_url: rd.file_url,
    mime_type: rd.mime_type, size_bytes: rd.size_bytes,
  } : null);
  // Per-line product mappings (index → product_id | 'skip')
  const [mappings, setMappings] = useState(rd?.mappings || {});
  // Per-line purchasing-unit forms (index → { purchase_uom, pack_size, ... })
  const [unitForms, setUnitForms] = useState(rd?.unit_forms || {});
  // Which line's purchasing-unit editor is expanded.
  const [expandedUnit, setExpandedUnit] = useState(null);
  // Which line is currently adding a brand-new product (index | null).
  const [addProductIdx, setAddProductIdx] = useState(null);
  // Draft persistence.
  const [draftId, setDraftId] = useState(rd?.id || null);
  const [savingDraft, setSavingDraft] = useState(false);
  // Editable header fields
  const [header, setHeader] = useState({
    supplier_id: rd?.supplier_id || preselectedSupplierId || '',
    invoice_number: rd?.invoice_number || '',
    invoice_date: rd?.invoice_date || '',
    due_date: rd?.due_date || '',
    due_date_overridden: !!rd?.due_date_overridden,
  });
  // When set, hand the scanned invoice into the canonical blind-receipt engine.
  const [receivePrefill, setReceivePrefill] = useState(null);

  // On resume, pull the stored scanned file back into a File so the rest of the
  // flow (PDF archive on save / receive) works exactly as a fresh scan.
  useEffect(() => {
    if (!rd?.file_url) return;
    let cancelled = false;
    (async () => {
      try {
        const resp = await fetch(rd.file_url);
        const blob = await resp.blob();
        if (!cancelled) {
          setScannedFile(new File([blob], rd.file_name || 'invoice', { type: rd.mime_type || blob.type }));
        }
      } catch { /* non-fatal — completion will just skip re-archiving */ }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers-active'],
    queryFn: () => base44.entities.Supplier.filter({ status: 'active' }, 'name', 200),
  });

  const { data: products = [] } = useQuery({
    queryKey: ['products-for-invoice-scan'],
    queryFn: () => base44.entities.Product.filter({ status: 'active' }, 'name', 1000),
  });

  // Supplier-product links for the chosen supplier — drives conversion lookup so
  // we know which linked lines still need a purchasing unit before receiving.
  const { data: supplierProducts = [] } = useQuery({
    queryKey: ['supplier-products-for-scan', header.supplier_id],
    queryFn: () => base44.entities.SupplierProduct.filter({ supplier_id: header.supplier_id, active: true }, 'product_name', 500),
    enabled: !!header.supplier_id,
  });

  const productById = useMemo(() => {
    const m = {};
    products.forEach(p => { m[p.id] = p; });
    return m;
  }, [products]);

  const spByProductId = useMemo(() => {
    const m = {};
    supplierProducts.forEach(sp => { m[sp.product_id] = sp; });
    return m;
  }, [supplierProducts]);

  const selectedSupplier = useMemo(
    () => suppliers.find(s => s.id === header.supplier_id),
    [suppliers, header.supplier_id],
  );

  const ingredientProducts = useMemo(
    () => products.filter(p => ['ingredient', 'raw_material', 'packaging'].includes(p.type)),
    [products],
  );

  // Auto-calculate the due date from the supplier's payment terms whenever the
  // supplier / invoice date changes — unless a date was scanned or hand-edited.
  useEffect(() => {
    if (header.due_date_overridden) return;
    if (!selectedSupplier?.payment_term_type || !header.invoice_date) {
      setHeader(p => (p.due_date ? { ...p, due_date: '' } : p));
      return;
    }
    const calc = calculateDueDate(header.invoice_date, selectedSupplier.payment_term_type, selectedSupplier.payment_term_value);
    const iso = calc ? toISODate(calc) : '';
    setHeader(p => (p.due_date === iso ? p : { ...p, due_date: iso }));
  }, [header.supplier_id, header.invoice_date, header.due_date_overridden, selectedSupplier]);

  const handleFile = useCallback(async (file) => {
    if (!file) return;
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'];
    if (!allowed.includes(file.type)) {
      toast.error('Unsupported file type. Upload a JPG, PNG, WebP, or PDF.');
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      toast.error('File too large. Maximum 20 MB.');
      return;
    }

    setScanning(true);
    setScanError(null);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const { data, error } = await supabase.functions.invoke('scan-invoice', { body: formData });
      if (error) throw new Error(error.message || 'Scan failed');
      if (data?.error) throw new Error(data.error);

      const inv = data?.data;
      if (!inv || !Array.isArray(inv.lines)) throw new Error('Unexpected response format from scan');

      setExtracted(inv);
      setScannedFile(file);

      // Pre-fill header fields from extracted data. A scanned explicit due date
      // is treated as an override; otherwise the terms-based effect fills it.
      setHeader(prev => ({
        ...prev,
        invoice_number: inv.invoice_number || prev.invoice_number || '',
        invoice_date: inv.invoice_date || prev.invoice_date || new Date().toISOString().slice(0, 10),
        due_date: inv.due_date || prev.due_date || '',
        due_date_overridden: inv.due_date ? true : prev.due_date_overridden,
      }));

      // Auto-match lines to products
      const initialMappings = {};
      inv.lines.forEach((line, idx) => {
        const matched = autoMatch(line.description, ingredientProducts);
        initialMappings[idx] = matched || 'skip';
      });
      setMappings(initialMappings);

      setStep(STEP_REVIEW);
    } catch (err) {
      setScanError(err.message || 'Unknown scan error');
    } finally {
      setScanning(false);
    }
  }, [ingredientProducts]);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const isMapped = (idx) => mappings[idx] && mappings[idx] !== 'skip';

  // Resolve a line's conversion factor: an existing supplier link wins, else the
  // hand-entered unit form. Returns 0 when neither yields a usable factor.
  const lineConversion = useCallback((idx) => {
    const productId = mappings[idx];
    if (!productId || productId === 'skip') return 0;
    const sp = spByProductId[productId];
    if (sp?.conversion_factor > 0) return Number(sp.conversion_factor);
    const cf = parseFloat(unitForms[idx]?.conversion_factor);
    return cf > 0 ? cf : 0;
  }, [mappings, spByProductId, unitForms]);

  // Pick (or change) the product on a line. New links with no saved conversion
  // open the purchasing-unit editor, seeded from the invoice line text.
  const linkProduct = (idx, productId) => {
    if (productId === ADD_NEW) {
      if (!header.supplier_id) { toast.error('Select a supplier first'); return; }
      setAddProductIdx(idx);
      return;
    }
    setMappings(prev => ({ ...prev, [idx]: productId }));
    if (!productId || productId === 'skip') {
      setUnitForms(prev => { const n = { ...prev }; delete n[idx]; return n; });
      if (expandedUnit === idx) setExpandedUnit(null);
      return;
    }
    const sp = spByProductId[productId];
    if (sp?.conversion_factor > 0) {
      // Already has a conversion — nothing to capture.
      setUnitForms(prev => { const n = { ...prev }; delete n[idx]; return n; });
      if (expandedUnit === idx) setExpandedUnit(null);
      return;
    }
    setUnitForms(prev => ({ ...prev, [idx]: seedUnitForm(extracted?.lines?.[idx], productById[productId]) }));
    setExpandedUnit(idx);
  };

  const setUnitField = (idx, key, value) =>
    setUnitForms(prev => ({ ...prev, [idx]: { ...prev[idx], [key]: value } }));

  // A brand-new product (+ supplier link with conversion) was created from a
  // line — refresh the catalogs and link the line to it. Seed the unit form
  // from the new supplier link so the conversion shows without waiting for the
  // query to land.
  const handleProductCreated = async (_line, sp, product) => {
    const idx = addProductIdx;
    setAddProductIdx(null);
    if (idx == null || !product) return;
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['products-for-invoice-scan'] }),
      queryClient.invalidateQueries({ queryKey: ['supplier-products-for-scan', header.supplier_id] }),
    ]);
    setMappings(prev => ({ ...prev, [idx]: product.id }));
    if (sp) {
      setUnitForms(prev => ({ ...prev, [idx]: {
        purchase_uom: sp.purchase_uom || '',
        pack_size: sp.pack_size != null ? String(sp.pack_size) : '',
        pack_size_uom: sp.pack_size_uom || '',
        pack_qty: sp.pack_qty != null ? String(sp.pack_qty) : '1',
        conversion_factor: sp.conversion_factor != null ? String(sp.conversion_factor) : '',
      } }));
    }
    setExpandedUnit(null);
    toast.success(`Linked to ${product.name}`);
  };

  // ── Draft persistence ───────────────────────────────────────────────────────
  const deleteDraftIfAny = async () => {
    if (!draftId) return;
    try { await base44.entities.InvoiceScanDraft.delete(draftId); } catch { /* best effort */ }
    queryClient.invalidateQueries({ queryKey: ['invoice-scan-drafts'] });
  };

  const handleSaveDraft = async () => {
    setSavingDraft(true);
    try {
      // Park the scanned file in storage once so a resumed draft keeps its PDF.
      let meta = draftFileMeta;
      if (!meta && scannedFile) {
        const ext = (scannedFile.name?.split('.').pop() || 'pdf').toLowerCase();
        const path = `drafts/${draftId || crypto.randomUUID()}/${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from('purchase-documents')
          .upload(path, scannedFile, { contentType: scannedFile.type || 'application/octet-stream', upsert: true });
        if (!upErr) {
          const { data: pub } = supabase.storage.from('purchase-documents').getPublicUrl(path);
          meta = {
            file_name: scannedFile.name || `scan.${ext}`, file_path: path,
            file_url: pub?.publicUrl || null, mime_type: scannedFile.type || null, size_bytes: scannedFile.size || null,
          };
          setDraftFileMeta(meta);
        }
      }

      const payload = {
        mode,
        supplier_id: header.supplier_id || null,
        supplier_name: selectedSupplier?.name || null,
        invoice_number: header.invoice_number || null,
        invoice_date: header.invoice_date || null,
        due_date: header.due_date || null,
        due_date_overridden: !!header.due_date_overridden,
        extracted,
        mappings,
        unit_forms: unitForms,
        ...(meta || {}),
      };

      if (draftId) {
        await base44.entities.InvoiceScanDraft.update(draftId, payload);
      } else {
        const created = await base44.entities.InvoiceScanDraft.create(payload);
        setDraftId(created.id);
      }
      queryClient.invalidateQueries({ queryKey: ['invoice-scan-drafts'] });
      toast.success('Draft saved — resume it any time from "Resume scan".');
      onClose?.();
    } catch (err) {
      toast.error('Failed to save draft: ' + (err.message || 'Unknown error'));
    } finally {
      setSavingDraft(false);
    }
  };

  const mappedIdxs = useMemo(
    () => (extracted?.lines || []).map((_, idx) => idx).filter(isMapped),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [extracted, mappings],
  );
  const skippedCount = (extracted?.lines?.length || 0) - mappedIdxs.length;
  const unresolvedConversions = mappedIdxs.filter(idx => lineConversion(idx) <= 0);
  const canReceive = mappedIdxs.length > 0 && unresolvedConversions.length === 0 && !!header.supplier_id;

  // ── Price-only save (original behaviour) ────────────────────────────────────
  const handleSave = async () => {
    if (!header.invoice_number) { toast.error('Enter an invoice number'); return; }
    if (!header.supplier_id) { toast.error('Select a supplier'); return; }

    setStep(STEP_SAVING);
    try {
      const supplier = suppliers.find(s => s.id === header.supplier_id);
      const now = new Date().toISOString();
      const invDate = header.invoice_date || now.slice(0, 10);
      const lines = extracted?.lines || [];

      const unmatchedCount = lines.filter((_, idx) => !isMapped(idx)).length;

      // 1. Create the invoice record (status reflects whether anything still
      //    needs reviewing, so unmatched lines surface in the queue).
      const invoice = await base44.entities.PurchaseInvoice.create({
        invoice_number: header.invoice_number,
        invoice_date: invDate,
        due_date: header.due_date || null,
        due_date_calculated: header.due_date || null,
        due_date_overridden: !!header.due_date_overridden,
        supplier_id: header.supplier_id,
        supplier_name: supplier?.name || '',
        subtotal: extracted?.subtotal || 0,
        tax_amount: extracted?.vat_amount || 0,
        total: extracted?.total || 0,
        status: unmatchedCount > 0 ? 'pending_match' : 'matched',
        source: 'scan',
        unmatched_line_count: unmatchedCount,
      });

      // Archive the original scanned document so it shows on the invoice / PO
      // Attachments tab — same place Xero-sourced PDFs land. Non-fatal.
      if (scannedFile) {
        try {
          const ext = (scannedFile.name?.split('.').pop() || 'pdf').toLowerCase();
          const path = `native/${invoice.id}/${crypto.randomUUID()}.${ext}`;
          const { error: upErr } = await supabase.storage
            .from('purchase-documents')
            .upload(path, scannedFile, { contentType: scannedFile.type || 'application/octet-stream', upsert: true });
          if (!upErr) {
            const { data: pub } = supabase.storage.from('purchase-documents').getPublicUrl(path);
            await base44.entities.PurchaseAttachment.create({
              invoice_id: invoice.id,
              source: 'native',
              file_name: scannedFile.name || `scan.${ext}`,
              file_path: path,
              file_url: pub?.publicUrl || null,
              mime_type: scannedFile.type || null,
              size_bytes: scannedFile.size || null,
            });
          }
        } catch { /* non-fatal — invoice is already saved */ }
      }

      // 2. Persist EVERY extracted line. Mapped lines are manually matched;
      //    everything else is saved as 'unmatched' so it flows into the
      //    Product Review Queue with the supplier's item code as the SKU.
      await Promise.all(lines.map((line, idx) => {
        const matched = isMapped(idx);
        const product = matched ? products.find(p => p.id === mappings[idx]) : null;
        const qty = line.qty || 0;
        const unitCost = line.unit_price || 0;
        return base44.entities.PurchaseInvoiceLine.create({
          invoice_id: invoice.id,
          xero_item_code: line.item_code || '',
          xero_description: line.description || '',
          product_id: matched ? mappings[idx] : null,
          product_name: product?.name || null,
          product_sku: product?.sku || null,
          qty,
          unit: line.unit || null,
          unit_cost: unitCost,
          line_total: line.line_total || (qty * unitCost) || 0,
          match_status: matched ? 'manually_matched' : 'unmatched',
        });
      }));

      // 3. For matched lines, refresh supplier price + capture the item code as
      //    the supplier SKU (when not already set) and log price history.
      const mappedLines = lines
        .map((line, idx) => ({ line, productId: mappings[idx] }))
        .filter(({ productId }) => productId && productId !== 'skip');
      await Promise.all(mappedLines.map(async ({ line, productId }) => {
        if (!line.unit_price) return;
        try {
          const existing = await base44.entities.SupplierProduct.filter({
            supplier_id: header.supplier_id,
            product_id: productId,
          }, 'created_date', 1);

          if (existing.length > 0) {
            const sp = existing[0];
            await base44.entities.SupplierProduct.update(sp.id, {
              last_purchase_price: line.unit_price,
              supplier_sku: sp.supplier_sku || line.item_code || '',
            });
            await base44.entities.SupplierPriceHistory.create({
              supplier_product_id: sp.id,
              supplier_name: supplier?.name || '',
              product_name: sp.product_name || '',
              product_sku: sp.product_sku || '',
              price: line.unit_price,
              effective_date: invDate,
              source: 'invoice',
              source_ref: invoice.invoice_number,
            });
          }
        } catch {
          // Non-fatal — invoice is already saved
        }
      }));

      await deleteDraftIfAny();

      setStep(STEP_DONE);
      toast.success(
        `Invoice ${header.invoice_number} saved — ${mappedLines.length} matched`
        + (unmatchedCount > 0 ? `, ${unmatchedCount} sent to Review Queue` : '')
      );
      onSaved?.();
    } catch (err) {
      setStep(STEP_REVIEW);
      toast.error('Failed to save invoice: ' + (err.message || 'Unknown error'));
    }
  };

  // ── Receive stock (scan → canonical blind receipt) ──────────────────────────
  // Make sure every linked line has a saved supplier_products link carrying the
  // conversion the blind receipt reads, then hand a prefilled receipt to it.
  const handleReceive = async () => {
    if (!header.supplier_id) { toast.error('Select a supplier'); return; }
    if (mappedIdxs.length === 0) { toast.error('Link at least one line to a product'); return; }
    if (unresolvedConversions.length > 0) {
      toast.error('Set a purchasing unit for every linked line first');
      setExpandedUnit(unresolvedConversions[0]);
      return;
    }

    setPreparing(true);
    try {
      const supplier = suppliers.find(s => s.id === header.supplier_id);
      const lines = extracted?.lines || [];
      const prefillLines = [];

      for (const idx of mappedIdxs) {
        const line = lines[idx];
        const productId = mappings[idx];
        const product = productById[productId];
        const existing = spByProductId[productId];
        const uf = unitForms[idx];

        let supplierProductId = existing?.id || null;
        let uomLabel = existing?.purchase_uom_label || existing?.purchase_uom || line.unit || '';

        // No saved conversion → persist the supplier link from the unit form,
        // mirroring the Review Queue's supplier_products payload shape.
        if (!(existing?.conversion_factor > 0) && uf) {
          const cf = parseFloat(uf.conversion_factor) || 1;
          const ps = uf.pack_size !== '' && uf.pack_size != null ? parseFloat(uf.pack_size) : null;
          const pq = uf.pack_qty !== '' && uf.pack_qty != null ? parseFloat(uf.pack_qty) : 1;
          const nc = line.unit_price || 0;
          const payload = {
            supplier_id: header.supplier_id,
            supplier_name: supplier?.name || '',
            product_id: productId,
            product_name: product?.name || '',
            product_sku: product?.sku || '',
            supplier_sku: existing?.supplier_sku || line.item_code || '',
            xero_item_code: line.item_code || null,
            purchase_uom: uf.purchase_uom || 'each',
            purchase_uom_label: uf.purchase_uom || 'each',
            purchase_uom_name: uf.purchase_uom || 'each',
            pack_size: ps,
            pack_size_uom: uf.pack_size_uom || null,
            pack_qty: pq,
            conversion_uom: product?.stock_uom || null,
            conversion_factor: cf,
            yield_factor: 1,
            effective_internal_qty: Math.round(cf * 1000) / 1000,
            nominal_cost: nc,
            price_per_stock_unit: cf > 0 ? nc / cf : 0,
            last_purchase_price: nc,
            active: true,
          };
          if (existing?.id) {
            await base44.entities.SupplierProduct.update(existing.id, payload);
            supplierProductId = existing.id;
          } else {
            const created = await base44.entities.SupplierProduct.create(payload);
            supplierProductId = created.id;
          }
          uomLabel = uf.purchase_uom || uomLabel;
        }

        prefillLines.push({
          product_id: productId,
          supplier_product_id: supplierProductId,
          invoiced_qty: line.qty != null ? String(line.qty) : '',
          received_qty: '',
          unit_cost: line.unit_price != null ? String(line.unit_price) : '',
          uom: uomLabel,
        });
      }

      setReceivePrefill({
        supplier_id: header.supplier_id,
        invoice_number: header.invoice_number || '',
        invoice_date: header.invoice_date || new Date().toISOString().slice(0, 10),
        due_date: header.due_date || '',
        due_date_overridden: !!header.due_date_overridden,
        lines: prefillLines,
        scannedFile,
      });
    } catch (err) {
      toast.error('Failed to prepare receipt: ' + (err.message || 'Unknown error'));
    } finally {
      setPreparing(false);
    }
  };

  const matchedCount = mappedIdxs.length;

  // The blind receipt takes over from here — it creates the PO + GRN + invoice
  // and moves stock, then we close the whole flow.
  if (receivePrefill) {
    return (
      <CreateBlindReceiptModal
        prefill={receivePrefill}
        onCreated={async () => { await deleteDraftIfAny(); onSaved?.(); onClose?.(); }}
        onCancel={() => setReceivePrefill(null)}
      />
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-card rounded-2xl border border-border w-full max-w-5xl shadow-xl flex flex-col max-h-[92vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <ScanLine className="w-5 h-5 text-primary" />
            <h3 className="text-lg font-bold">Scan Invoice</h3>
            {step === STEP_REVIEW && (
              <Badge className="bg-blue-100 text-blue-700 text-[10px]">Review Extracted Lines</Badge>
            )}
            {step === STEP_DONE && (
              <Badge className="bg-green-100 text-green-700 text-[10px]">Saved</Badge>
            )}
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}><X className="w-5 h-5" /></Button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

          {/* Step 1 — Upload */}
          {(step === STEP_UPLOAD || scanning) && (
            <div className="space-y-4">
              {/* Mode toggle — chosen up-front */}
              <div className="space-y-2">
                <ModeToggle mode={mode} onChange={setMode} disabled={scanning} />
                <p className="text-xs text-muted-foreground">
                  {mode === MODE_BLIND
                    ? 'Blind receipt — no PO needed. After scanning, you confirm quantities and the stock is received directly (one invoice + GRN created).'
                    : 'Standard invoice — saved live so you can match it to an open purchase order / GRN. No stock is moved.'}
                </p>
              </div>

              <p className="text-sm text-muted-foreground">
                Upload a photo or PDF of your supplier invoice. The line items, totals, date and due date are extracted automatically.
              </p>

              <div
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => !scanning && fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-colors ${
                  dragOver ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50 hover:bg-muted/30'
                } ${scanning ? 'pointer-events-none opacity-60' : ''}`}
              >
                {scanning ? (
                  <div className="flex flex-col items-center gap-3">
                    <Loader2 className="w-10 h-10 text-primary animate-spin" />
                    <p className="text-sm font-medium text-muted-foreground">Scanning invoice...</p>
                    <p className="text-xs text-muted-foreground">Extracting line items, totals & dates</p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-3">
                    <Upload className="w-10 h-10 text-muted-foreground" />
                    <p className="text-sm font-medium">Drop invoice here or click to browse</p>
                    <p className="text-xs text-muted-foreground">JPG, PNG, WebP, or PDF · Max 20 MB</p>
                  </div>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif,application/pdf"
                className="hidden"
                onChange={e => handleFile(e.target.files?.[0])}
              />

              {scanError && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium">Scan failed</p>
                    <p className="text-xs mt-0.5">{scanError}</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Step 2 — Review */}
          {step === STEP_REVIEW && extracted && (
            <div className="space-y-5">
              {/* Mode toggle — still switchable mid-review */}
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <ModeToggle mode={mode} onChange={setMode} />
                <p className="text-[11px] text-muted-foreground">
                  {mode === MODE_BLIND ? 'Will receive stock' : 'Will save as a live invoice to match'}
                </p>
              </div>

              {/* Invoice header fields */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase block mb-1">Supplier *</label>
                  <SearchableSelect
                    value={header.supplier_id}
                    onValueChange={v => setHeader(p => ({ ...p, supplier_id: v }))}
                    options={suppliers.map(s => ({ value: s.id, label: s.name }))}
                    placeholder="Select supplier..."
                    searchPlaceholder="Search suppliers..."
                  />
                  {extracted.supplier_name && (
                    <p className="text-[10px] text-muted-foreground mt-1">Detected: {extracted.supplier_name}</p>
                  )}
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase block mb-1">Invoice # *</label>
                  <Input
                    value={header.invoice_number}
                    onChange={e => setHeader(p => ({ ...p, invoice_number: e.target.value }))}
                    placeholder="INV-001"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase block mb-1">Invoice Date</label>
                  <Input
                    type="date"
                    value={header.invoice_date}
                    onChange={e => setHeader(p => ({ ...p, invoice_date: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase block mb-1">Due Date</label>
                  <div className="flex gap-2">
                    <Input
                      type="date"
                      value={header.due_date}
                      onChange={e => setHeader(p => ({ ...p, due_date: e.target.value, due_date_overridden: true }))}
                      className="flex-1"
                    />
                    {header.due_date_overridden && (
                      <Button
                        variant="ghost" size="sm" className="text-xs text-muted-foreground"
                        onClick={() => setHeader(p => ({ ...p, due_date_overridden: false }))}
                      >
                        Reset
                      </Button>
                    )}
                  </div>
                  {selectedSupplier?.payment_term_type && !header.due_date_overridden && (
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      Auto: {formatPaymentTerms(selectedSupplier.payment_term_type, selectedSupplier.payment_term_value)}
                    </p>
                  )}
                  {extracted.payment_terms && (
                    <p className="text-[10px] text-muted-foreground mt-0.5">Detected terms: {extracted.payment_terms}</p>
                  )}
                </div>
              </div>

              {/* Totals strip */}
              {(extracted.subtotal != null || extracted.total != null) && (
                <div className="flex gap-4 p-3 rounded-lg bg-muted/40 text-sm">
                  {extracted.subtotal != null && <span className="text-muted-foreground">Subtotal: <strong>R {extracted.subtotal.toFixed(2)}</strong></span>}
                  {extracted.vat_amount != null && <span className="text-muted-foreground">VAT: <strong>R {extracted.vat_amount.toFixed(2)}</strong></span>}
                  {extracted.total != null && <span className="text-muted-foreground">Total: <strong className="text-foreground">R {extracted.total.toFixed(2)}</strong></span>}
                </div>
              )}

              {/* Line items */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-semibold">{extracted.lines.length} line{extracted.lines.length !== 1 ? 's' : ''} extracted</p>
                  <p className="text-xs text-muted-foreground">{matchedCount} linked · {skippedCount} → review queue</p>
                </div>
                <div className="border border-border rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-muted/50 border-b border-border">
                        <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Invoice Line</th>
                        <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase w-16">Qty</th>
                        <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase w-24">Unit Price</th>
                        <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Link to Product</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {extracted.lines.map((line, idx) => {
                        const productId = mappings[idx];
                        const isSkipped = !productId || productId === 'skip';
                        const sp = !isSkipped ? spByProductId[productId] : null;
                        const product = !isSkipped ? productById[productId] : null;
                        const cf = lineConversion(idx);
                        // Conversions only matter when we're going to move stock.
                        const showUnit = mode === MODE_BLIND && !isSkipped;
                        const needsUnit = showUnit && cf <= 0;
                        const isExpanded = expandedUnit === idx;
                        return (
                          <React.Fragment key={idx}>
                            <tr className={isSkipped ? 'opacity-50' : ''}>
                              <td className="px-3 py-2">
                                <p className="text-xs font-medium">{line.description}</p>
                                <div className="flex items-center gap-1.5 mt-0.5">
                                  {line.item_code && (
                                    <span className="text-[10px] font-mono bg-muted px-1.5 py-0.5 rounded">{line.item_code}</span>
                                  )}
                                  {line.unit && <span className="text-[10px] text-muted-foreground">{line.unit}</span>}
                                </div>
                              </td>
                              <td className="px-3 py-2 text-right text-xs">
                                {line.qty != null ? line.qty : '—'}
                              </td>
                              <td className="px-3 py-2 text-right text-xs font-medium">
                                {line.unit_price != null ? `R ${line.unit_price.toFixed(2)}` : '—'}
                              </td>
                              <td className="px-3 py-2">
                                <ProductPicker
                                  value={productId || 'skip'}
                                  onChange={v => linkProduct(idx, v)}
                                  allProducts={products}
                                />
                                {showUnit && (
                                  <div className="flex items-center gap-2 mt-1">
                                    {cf > 0 ? (
                                      <span className="text-[10px] text-green-600 inline-flex items-center gap-1">
                                        <Check className="w-3 h-3" />
                                        1 {(sp?.purchase_uom_label || sp?.purchase_uom || unitForms[idx]?.purchase_uom || 'unit')} = {cf} {product?.stock_uom || ''}
                                      </span>
                                    ) : (
                                      <button
                                        type="button"
                                        className="text-[10px] text-amber-600 inline-flex items-center gap-1 hover:underline font-medium"
                                        onClick={() => setExpandedUnit(isExpanded ? null : idx)}
                                      >
                                        <Settings2 className="w-3 h-3" />
                                        Set purchasing unit
                                      </button>
                                    )}
                                  </div>
                                )}
                              </td>
                            </tr>
                            {needsUnit && isExpanded && (
                              <tr>
                                <td colSpan={4} className="px-3 py-3 bg-muted/30">
                                  <p className="text-[11px] text-muted-foreground mb-2">
                                    How <strong>{product?.name}</strong> is ordered from this supplier — sets the conversion used to add stock (stock unit: {product?.stock_uom || 'each'}).
                                  </p>
                                  <PurchasingUnitFields
                                    form={unitForms[idx] || seedUnitForm(line, product)}
                                    set={(k, v) => setUnitField(idx, k, v)}
                                    stockUom={product?.stock_uom || 'each'}
                                  />
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="text-xs text-muted-foreground space-y-1">
                {mode === MODE_BLIND ? (
                  <>
                    <p><strong>Receive stock</strong> hands the linked lines to a blind receipt: it creates the invoice + GRN and adds stock using the conversions above.</p>
                    {skippedCount > 0 && (
                      <p className="text-amber-600">{skippedCount} unlinked line{skippedCount !== 1 ? 's' : ''} won't be received — link them, or switch to <strong>Invoice</strong> mode.</p>
                    )}
                  </>
                ) : (
                  <p><strong>Save invoice</strong> records a live invoice (matched lines update supplier prices; unlinked lines go to the Review Queue) ready to match against an open PO / GRN. No stock is moved.</p>
                )}
              </div>
            </div>
          )}

          {/* Step done */}
          {step === STEP_DONE && (
            <div className="flex flex-col items-center gap-4 py-12">
              <CheckCircle2 className="w-16 h-16 text-green-500" />
              <p className="text-lg font-semibold">Invoice saved</p>
              <p className="text-sm text-muted-foreground text-center">
                Live invoice created — ready to match against an open PO / GRN.
                {matchedCount > 0 && ` ${matchedCount} product price${matchedCount !== 1 ? 's' : ''} updated.`}
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border shrink-0 flex gap-3">
          {step === STEP_DONE ? (
            <Button className="flex-1" onClick={onClose}>Close</Button>
          ) : step === STEP_REVIEW ? (
            <>
              <Button variant="outline" onClick={() => { setStep(STEP_UPLOAD); setExtracted(null); setMappings({}); setUnitForms({}); setExpandedUnit(null); setScannedFile(null); }}>
                Rescan
              </Button>
              <Button variant="outline" className="gap-2" onClick={handleSaveDraft} disabled={savingDraft}>
                {savingDraft ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save as Draft
              </Button>
              {mode === MODE_BLIND ? (
                <Button
                  className="flex-1 gap-2"
                  onClick={handleReceive}
                  disabled={!canReceive || preparing}
                  title={!canReceive ? 'Link lines and set a purchasing unit for each to receive stock' : undefined}
                >
                  {preparing ? <Loader2 className="w-4 h-4 animate-spin" /> : <PackageCheck className="w-4 h-4" />}
                  Receive Stock ({mappedIdxs.length})
                </Button>
              ) : (
                <Button
                  className="flex-1 gap-2"
                  onClick={handleSave}
                  disabled={!header.invoice_number || !header.supplier_id}
                >
                  <FileText className="w-4 h-4" />
                  Save Invoice
                </Button>
              )}
            </>
          ) : (
            <Button variant="outline" className="flex-1" onClick={onClose} disabled={scanning}>
              Cancel
            </Button>
          )}
        </div>
      </div>

      {/* Inline product creation — for a line whose product doesn't exist yet. */}
      {addProductIdx != null && extracted?.lines?.[addProductIdx] && (
        <CreateProductFromLineModal
          line={{
            xero_description: extracted.lines[addProductIdx].description || '',
            xero_item_code: extracted.lines[addProductIdx].item_code || '',
            unit: extracted.lines[addProductIdx].unit || '',
            qty: extracted.lines[addProductIdx].qty,
            unit_cost: extracted.lines[addProductIdx].unit_price,
            line_total: extracted.lines[addProductIdx].line_total,
          }}
          invoice={{ supplier_id: header.supplier_id, supplier_name: selectedSupplier?.name || '' }}
          onCreated={handleProductCreated}
          onCancel={() => setAddProductIdx(null)}
        />
      )}
    </div>
  );
}

function ProductPicker({ value, onChange, allProducts }) {
  const options = useMemo(() => [
    {
      value: 'skip',
      label: 'Send to review queue',
      node: (
        <span className="flex items-center gap-1.5 text-muted-foreground"><Unlink className="w-3 h-3" /> Send to review queue</span>
      ),
    },
    {
      value: ADD_NEW,
      label: 'Add new product',
      keywords: ['add', 'new', 'create', 'product'],
      node: (
        <span className="flex items-center gap-1.5 text-primary font-medium"><Plus className="w-3 h-3" /> Add new product…</span>
      ),
    },
    ...allProducts.map(p => ({
      value: p.id,
      label: `${p.name}${p.sku ? ` ${p.sku}` : ''}`,
      keywords: [p.name, p.sku].filter(Boolean),
      node: (
        <span className="flex items-center gap-1.5 truncate">
          <Package className="w-3 h-3 text-muted-foreground shrink-0" />
          <span className="truncate">{p.name}</span>
          {p.sku && <span className="text-muted-foreground font-mono text-[10px]">· {p.sku}</span>}
        </span>
      ),
    })),
  ], [allProducts]);

  return (
    <SearchableSelect
      value={value || 'skip'}
      onValueChange={onChange}
      options={options}
      placeholder="Review queue"
      searchPlaceholder="Search products..."
      triggerClassName="h-8 text-xs"
      contentClassName="w-[320px]"
    />
  );
}
