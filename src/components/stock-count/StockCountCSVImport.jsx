import React, { useState, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { X, Upload, Loader2, FileSpreadsheet, AlertTriangle, CheckCircle2, Download } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/AuthContext';
import { parseCSV, parseNumber } from '@/lib/csv';
import { createCsvCount } from '@/lib/stockCount';

const findCol = (header, names) => {
  for (const n of names) {
    const i = header.findIndex(h => h === n || h.includes(n));
    if (i !== -1) return i;
  }
  return -1;
};

export default function StockCountCSVImport({ onImported, onCancel }) {
  const { user } = useAuth();
  const userName = user?.full_name || user?.email || 'System';
  const fileRef = useRef(null);

  const [locationId, setLocationId] = useState('');
  const [parsed, setParsed] = useState(null); // { valid: [...], errors: [...] }
  const [importing, setImporting] = useState(false);

  const { data: locations = [] } = useQuery({
    queryKey: ['locations-stock-bearing'],
    queryFn: () => base44.entities.Location.filter({ is_stock_bearing: true }, 'name', 200),
  });

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!locationId) { toast.error('Select a location first'); fileRef.current.value = ''; return; }

    try {
      const text = await file.text();
      const { header, rows } = parseCSV(text);
      const skuIdx = findCol(header, ['sku', 'code']);
      const qtyIdx = findCol(header, ['counted', 'qty', 'quantity', 'count']);
      const uomIdx = findCol(header, ['uom', 'unit']);
      if (skuIdx === -1 || qtyIdx === -1) {
        toast.error('CSV needs at least a SKU column and a counted quantity column');
        return;
      }

      // Reference data
      const products = await base44.entities.Product.filter({ status: 'active' }, 'name', 5000);
      const bySku = {};
      products.forEach(p => { if (p.sku) bySku[p.sku.toLowerCase()] = p; });
      const matchedIds = [];
      rows.forEach(r => { const p = bySku[(r[skuIdx] || '').toLowerCase()]; if (p) matchedIds.push(p.id); });
      const countUoms = matchedIds.length
        ? await base44.entities.StockCountUom.filter({ product_id: matchedIds }, 'count_uom', 5000)
        : [];
      const uomsByProduct = {};
      countUoms.forEach(u => { (uomsByProduct[u.product_id] = uomsByProduct[u.product_id] || []).push(u); });

      const valid = [];
      const errors = [];
      const seenSku = new Set();

      rows.forEach((r, idx) => {
        const rawSku = (r[skuIdx] || '').trim();
        const line = idx + 2; // 1-based + header
        if (!rawSku) { errors.push({ line, sku: '', reason: 'Missing SKU' }); return; }
        const product = bySku[rawSku.toLowerCase()];
        if (!product) { errors.push({ line, sku: rawSku, reason: 'SKU not found' }); return; }
        if (seenSku.has(rawSku.toLowerCase())) { errors.push({ line, sku: rawSku, reason: 'Duplicate SKU' }); return; }
        seenSku.add(rawSku.toLowerCase());

        const qty = parseNumber(r[qtyIdx]);
        if (!Number.isFinite(qty) || qty < 0) { errors.push({ line, sku: rawSku, reason: 'Invalid quantity' }); return; }

        const stockUom = product.stock_uom || 'pcs';
        const rawUom = uomIdx !== -1 ? (r[uomIdx] || '').trim() : '';
        let count_uom = stockUom, conversion_factor = 1, count_uom_label = '';

        if (rawUom) {
          if (rawUom.toLowerCase() === stockUom.toLowerCase()) {
            count_uom = stockUom; conversion_factor = 1;
          } else {
            const match = (uomsByProduct[product.id] || []).find(u => (u.count_uom || '').toLowerCase() === rawUom.toLowerCase());
            if (!match) { errors.push({ line, sku: rawSku, reason: `UOM "${rawUom}" not valid for item` }); return; }
            if (!(Number(match.conversion_factor) > 0)) { errors.push({ line, sku: rawSku, reason: 'Missing conversion factor for UOM' }); return; }
            count_uom = match.count_uom; conversion_factor = Number(match.conversion_factor); count_uom_label = match.count_uom_label || '';
          }
        } else {
          // Default to the product's default count UOM, else main stock UOM.
          const def = (uomsByProduct[product.id] || []).find(u => u.is_default);
          if (def && Number(def.conversion_factor) > 0) {
            count_uom = def.count_uom; conversion_factor = Number(def.conversion_factor); count_uom_label = def.count_uom_label || '';
          }
        }

        valid.push({
          line, product_id: product.id, product_sku: product.sku, product_name: product.name,
          stock_uom: stockUom, count_uom, count_uom_label, conversion_factor, counted_qty: qty,
        });
      });

      setParsed({ valid, errors });
      if (!valid.length) toast.error('No valid rows found in the CSV');
    } catch (err) {
      toast.error('Could not read CSV: ' + (err.message || 'Unknown error'));
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleImport = async () => {
    const location = locations.find(l => l.id === locationId);
    if (!location || !parsed?.valid.length) return;
    setImporting(true);
    try {
      const header = await createCsvCount({ location, rows: parsed.valid, userName });
      toast.success(`Imported ${parsed.valid.length} lines as ${header.reference}`);
      onImported(header);
    } catch (err) {
      toast.error('Import failed: ' + (err.message || 'Unknown error'));
    } finally {
      setImporting(false);
    }
  };

  const downloadTemplate = () => {
    const blob = new Blob(['sku,counted_qty,count_uom\n'], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'stock_count_template.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4">
      <div className="bg-card rounded-2xl border border-border w-full max-w-lg shadow-xl max-h-[88vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h3 className="text-lg font-bold flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-primary" /> Import Count from CSV
          </h3>
          <Button variant="ghost" size="icon" onClick={onCancel}><X className="w-5 h-5" /></Button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          <div className="space-y-1">
            <Label className="text-xs">Stock Location *</Label>
            <Select value={locationId} onValueChange={v => { setLocationId(v); setParsed(null); }}>
              <SelectTrigger><SelectValue placeholder="Select location..." /></SelectTrigger>
              <SelectContent className="z-[70]">
                {locations.map(l => <SelectItem key={l.id} value={l.id}>{l.name} ({l.code})</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between gap-2 rounded-lg border border-dashed border-border p-3">
            <div className="text-xs text-muted-foreground">
              Columns: <span className="font-mono">sku</span>, <span className="font-mono">counted_qty</span>, optional <span className="font-mono">count_uom</span>.
              No UOM → the item's default count unit is used.
            </div>
            <Button variant="ghost" size="sm" className="gap-1.5 shrink-0" onClick={downloadTemplate}>
              <Download className="w-3.5 h-3.5" /> Template
            </Button>
          </div>

          <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={handleFile} className="hidden" />
          <Button variant="outline" className="w-full gap-2" onClick={() => fileRef.current?.click()} disabled={!locationId}>
            <Upload className="w-4 h-4" /> Choose CSV file
          </Button>

          {parsed && (
            <div className="space-y-3">
              <div className="flex items-center gap-3 text-sm">
                <span className="flex items-center gap-1 text-green-600"><CheckCircle2 className="w-4 h-4" /> {parsed.valid.length} valid</span>
                {parsed.errors.length > 0 && (
                  <span className="flex items-center gap-1 text-red-600"><AlertTriangle className="w-4 h-4" /> {parsed.errors.length} rejected</span>
                )}
              </div>

              {parsed.errors.length > 0 && (
                <div className="rounded-lg border border-red-200 bg-red-50 max-h-40 overflow-y-auto text-xs">
                  {parsed.errors.map((e, i) => (
                    <div key={i} className="px-3 py-1.5 border-b border-red-100 last:border-0 flex justify-between gap-2">
                      <span className="font-mono">{e.sku || `Row ${e.line}`}</span>
                      <span className="text-red-600">{e.reason}</span>
                    </div>
                  ))}
                </div>
              )}

              {parsed.valid.length > 0 && (
                <div className="rounded-lg border border-border max-h-44 overflow-y-auto text-xs">
                  {parsed.valid.slice(0, 200).map((v, i) => (
                    <div key={i} className="px-3 py-1.5 border-b border-border last:border-0 flex justify-between gap-2">
                      <span className="truncate">{v.product_name}</span>
                      <span className="tabular-nums shrink-0">{v.counted_qty} {v.count_uom}{v.conversion_factor !== 1 ? ` → ${v.counted_qty * v.conversion_factor} ${v.stock_uom}` : ''}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-border flex gap-3">
          <Button variant="outline" className="flex-1" onClick={onCancel}>Cancel</Button>
          <Button className="flex-1 gap-2" onClick={handleImport} disabled={importing || !parsed?.valid.length}>
            {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}
            {importing ? 'Importing...' : `Import ${parsed?.valid.length || 0} lines`}
          </Button>
        </div>
      </div>
    </div>
  );
}
