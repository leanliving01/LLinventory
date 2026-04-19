import React, { useState, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Upload, Download, CheckCircle2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';

export default function ParLevelCSVImport({ skus, parBySkuId }) {
  const queryClient = useQueryClient();
  const fileRef = useRef(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);

  const skuByCode = {};
  skus.forEach(s => { skuByCode[s.sku_code?.toLowerCase()] = s; });

  const handleDownloadSample = () => {
    const header = 'sku_code,par_level,effective_from';
    const rows = skus
      .filter(s => s.is_active !== false)
      .slice(0, 5)
      .map(s => {
        const par = parBySkuId[s.id];
        return `${s.sku_code},${par?.par_level || 0},${format(new Date(), 'yyyy-MM-dd')}`;
      });

    const csv = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'par_levels_sample.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleFileSelect = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setImporting(true);
    setResult(null);

    const text = await file.text();
    const lines = text.split('\n').filter(l => l.trim());

    if (lines.length < 2) {
      toast.error('CSV must have a header row and at least one data row');
      setImporting(false);
      return;
    }

    const header = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/"/g, ''));
    const skuColIdx = header.findIndex(h => h.includes('sku') || h.includes('code'));
    const parColIdx = header.findIndex(h => h.includes('par') || h.includes('level'));
    const dateColIdx = header.findIndex(h => h.includes('effective') || h.includes('date') || h.includes('from'));

    if (skuColIdx === -1 || parColIdx === -1) {
      toast.error('CSV must have columns for sku_code and par_level');
      setImporting(false);
      return;
    }

    const today = format(new Date(), 'yyyy-MM-dd');
    let matched = 0;
    let unmatched = 0;

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map(c => c.trim().replace(/"/g, ''));
      const skuCode = cols[skuColIdx]?.toLowerCase();
      const parVal = parseInt(cols[parColIdx], 10);
      const effectiveFrom = dateColIdx !== -1 && cols[dateColIdx] ? cols[dateColIdx] : today;

      if (!skuCode || isNaN(parVal)) continue;

      const sku = skuByCode[skuCode];
      if (sku) {
        const existing = parBySkuId[sku.id];
        if (existing) {
          await base44.entities.ParLevel.update(existing.id, {
            par_level: parVal,
            effective_from: effectiveFrom,
          });
        } else {
          await base44.entities.ParLevel.create({
            sku_id: sku.id,
            sku_display_name: sku.display_name || '',
            package_type: sku.package_type || '',
            par_level: parVal,
            effective_from: effectiveFrom,
          });
        }
        matched++;
      } else {
        unmatched++;
      }
    }

    queryClient.invalidateQueries({ queryKey: ['parLevels'] });
    setResult({ matched, unmatched, total: lines.length - 1 });
    toast.success(`Imported par levels for ${matched} SKUs`);
    setImporting(false);
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold">CSV Par Level Import</h3>
          <p className="text-xs text-muted-foreground">Upload a CSV with columns: sku_code, par_level, effective_from (optional)</p>
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <input ref={fileRef} type="file" accept=".csv" onChange={handleFileSelect} className="hidden" />
        <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={importing} className="gap-2">
          <Upload className="w-3.5 h-3.5" />
          {importing ? 'Importing...' : 'Upload CSV'}
        </Button>
        <Button variant="ghost" size="sm" onClick={handleDownloadSample} className="gap-2">
          <Download className="w-3.5 h-3.5" />
          Download Sample
        </Button>

        {result && (
          <div className="flex items-center gap-2 text-xs">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
            <span className="text-emerald-700">{result.matched} matched</span>
            {result.unmatched > 0 && (
              <>
                <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                <span className="text-amber-600">{result.unmatched} unmatched</span>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}