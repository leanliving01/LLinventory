import React, { useState, useCallback, useRef, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44, supabase } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  X, Upload, Loader2, ScanLine, CheckCircle2, AlertCircle, FileText,
  ChevronRight, Package, Link2, Unlink,
} from 'lucide-react';
import { toast } from 'sonner';

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

export default function InvoiceScanDialog({ onClose, onSaved, preselectedSupplierId }) {
  const fileInputRef = useRef(null);
  const [step, setStep] = useState(STEP_UPLOAD);
  const [dragOver, setDragOver] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState(null);

  // Extracted invoice data
  const [extracted, setExtracted] = useState(null);
  // Per-line product mappings (index → product_id | 'skip')
  const [mappings, setMappings] = useState({});
  // Editable header fields
  const [header, setHeader] = useState({ supplier_id: preselectedSupplierId || '', invoice_number: '', invoice_date: '' });

  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers-active'],
    queryFn: () => base44.entities.Supplier.filter({ status: 'active' }, 'name', 200),
  });

  const { data: products = [] } = useQuery({
    queryKey: ['products-for-invoice-scan'],
    queryFn: () => base44.entities.Product.filter({ status: 'active' }, 'name', 1000),
  });

  const ingredientProducts = useMemo(
    () => products.filter(p => ['ingredient', 'raw_material', 'packaging'].includes(p.type)),
    [products],
  );

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

      // Pre-fill header fields from extracted data
      setHeader(prev => ({
        supplier_id: prev.supplier_id || '',
        invoice_number: inv.invoice_number || prev.invoice_number || '',
        invoice_date: inv.invoice_date || prev.invoice_date || new Date().toISOString().slice(0, 10),
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

  const handleSave = async () => {
    if (!header.invoice_number) { toast.error('Enter an invoice number'); return; }
    if (!header.supplier_id) { toast.error('Select a supplier'); return; }

    setStep(STEP_SAVING);
    try {
      const supplier = suppliers.find(s => s.id === header.supplier_id);
      const now = new Date().toISOString();
      const mappedLines = (extracted?.lines || [])
        .map((line, idx) => ({ line, productId: mappings[idx] }))
        .filter(({ productId }) => productId && productId !== 'skip');

      // 1. Create the invoice record
      const invoice = await base44.entities.PurchaseInvoice.create({
        invoice_number: header.invoice_number,
        invoice_date: header.invoice_date || now.slice(0, 10),
        supplier_id: header.supplier_id,
        supplier_name: supplier?.name || '',
        subtotal: extracted?.subtotal || null,
        vat_amount: extracted?.vat_amount || null,
        total: extracted?.total || null,
        status: 'matched',
        source: 'scan',
        unmatched_line_count: 0,
      });

      // 2. Create invoice lines
      if (mappedLines.length > 0) {
        await Promise.all(mappedLines.map(({ line, productId }) => {
          const product = products.find(p => p.id === productId);
          return base44.entities.PurchaseInvoiceLine.create({
            purchase_invoice_id: invoice.id,
            product_id: productId,
            product_name: product?.name || line.description,
            product_sku: product?.sku || '',
            description: line.description,
            qty: line.qty || 0,
            uom: line.unit || product?.stock_uom || '',
            unit_price: line.unit_price || 0,
            line_total: line.line_total || (line.qty * line.unit_price) || 0,
            match_status: 'matched',
          });
        }));
      }

      // 3. Update supplier_products.last_purchase_price + insert price history for each matched line
      await Promise.all(mappedLines.map(async ({ line, productId }) => {
        if (!line.unit_price) return;
        try {
          // Upsert supplier_product record
          const existing = await base44.entities.SupplierProduct.filter({
            supplier_id: header.supplier_id,
            product_id: productId,
          }, 'created_date', 1);

          if (existing.length > 0) {
            await base44.entities.SupplierProduct.update(existing[0].id, {
              last_purchase_price: line.unit_price,
              purchase_uom: line.unit || existing[0].purchase_uom || '',
            });
          }

          // Insert price history
          await base44.entities.SupplierPriceHistory.create({
            supplier_id: header.supplier_id,
            product_id: productId,
            invoice_id: invoice.id,
            price: line.unit_price,
            uom: line.unit || '',
            effective_date: header.invoice_date || now.slice(0, 10),
            source: 'invoice_scan',
          });
        } catch {
          // Non-fatal — invoice is already saved
        }
      }));

      setStep(STEP_DONE);
      toast.success(`Invoice ${header.invoice_number} saved with ${mappedLines.length} matched line${mappedLines.length !== 1 ? 's' : ''}`);
      onSaved?.();
    } catch (err) {
      setStep(STEP_REVIEW);
      toast.error('Failed to save invoice: ' + (err.message || 'Unknown error'));
    }
  };

  const matchedCount = Object.values(mappings).filter(v => v && v !== 'skip').length;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-card rounded-2xl border border-border w-full max-w-3xl shadow-xl flex flex-col max-h-[90vh]">

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
              <p className="text-sm text-muted-foreground">
                Upload a photo or PDF of your supplier invoice. GPT-4o will extract the line items automatically.
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
                    <p className="text-xs text-muted-foreground">GPT-4o is extracting line items</p>
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
              {/* Invoice header fields */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase block mb-1">Supplier *</label>
                  <Select value={header.supplier_id} onValueChange={v => setHeader(p => ({ ...p, supplier_id: v }))}>
                    <SelectTrigger><SelectValue placeholder="Select supplier..." /></SelectTrigger>
                    <SelectContent>
                      {suppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
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
                  <p className="text-xs text-muted-foreground">{matchedCount} matched · {extracted.lines.length - matchedCount} skipped</p>
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
                        const linkedProduct = !isSkipped ? products.find(p => p.id === productId) : null;
                        return (
                          <tr key={idx} className={isSkipped ? 'opacity-50' : ''}>
                            <td className="px-3 py-2">
                              <p className="text-xs font-medium">{line.description}</p>
                              {line.unit && <p className="text-[10px] text-muted-foreground">{line.unit}</p>}
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
                                onChange={v => setMappings(prev => ({ ...prev, [idx]: v }))}
                                products={ingredientProducts}
                                allProducts={products}
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <p className="text-xs text-muted-foreground">
                Prices will be saved to each matched product's supplier record and price history. BOMs and stock levels are unaffected.
              </p>
            </div>
          )}

          {/* Step done */}
          {step === STEP_DONE && (
            <div className="flex flex-col items-center gap-4 py-12">
              <CheckCircle2 className="w-16 h-16 text-green-500" />
              <p className="text-lg font-semibold">Invoice saved</p>
              <p className="text-sm text-muted-foreground text-center">
                {matchedCount} product price{matchedCount !== 1 ? 's' : ''} updated from this invoice.
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
              <Button variant="outline" onClick={() => { setStep(STEP_UPLOAD); setExtracted(null); setMappings({}); }}>
                Rescan
              </Button>
              <Button
                className="flex-1 gap-2"
                onClick={handleSave}
                disabled={!header.invoice_number || !header.supplier_id}
              >
                <FileText className="w-4 h-4" />
                Save Invoice + Update Prices
              </Button>
            </>
          ) : (
            <Button variant="outline" className="flex-1" onClick={onClose} disabled={scanning}>
              Cancel
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function ProductPicker({ value, onChange, products, allProducts }) {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!search) return products.slice(0, 30);
    const q = search.toLowerCase();
    return allProducts
      .filter(p => p.name.toLowerCase().includes(q) || (p.sku || '').toLowerCase().includes(q))
      .slice(0, 30);
  }, [products, allProducts, search]);

  return (
    <Select value={value || 'skip'} onValueChange={onChange}>
      <SelectTrigger className="h-8 text-xs">
        <SelectValue>
          {value && value !== 'skip'
            ? <span className="flex items-center gap-1"><Link2 className="w-3 h-3 text-green-600" />{allProducts.find(p => p.id === value)?.name || 'Unknown'}</span>
            : <span className="flex items-center gap-1 text-muted-foreground"><Unlink className="w-3 h-3" />Skip</span>
          }
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <div className="px-2 py-1.5">
          <Input
            placeholder="Search products..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="h-7 text-xs"
            onClick={e => e.stopPropagation()}
          />
        </div>
        <SelectItem value="skip">
          <span className="flex items-center gap-1.5 text-muted-foreground"><Unlink className="w-3 h-3" /> Skip this line</span>
        </SelectItem>
        {filtered.map(p => (
          <SelectItem key={p.id} value={p.id}>
            <span className="flex items-center gap-1.5">
              <Package className="w-3 h-3 text-muted-foreground shrink-0" />
              <span>{p.name}</span>
              {p.sku && <span className="text-muted-foreground font-mono text-[10px]">· {p.sku}</span>}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
