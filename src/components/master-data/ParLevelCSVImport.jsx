import React, { useState, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Upload, Download, CheckCircle2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { PACKAGE_TYPES, PACKAGE_LABELS, groupSkusByMeal } from '@/lib/mealGrouping';

export default function ParLevelCSVImport({ skus, meals, parBySkuId }) {
  const queryClient = useQueryClient();
  const fileRef = useRef(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);

  const handleDownloadSample = () => {
    const mealGroups = groupSkusByMeal(skus, meals);

    // Header: meal_name, then each package type abbreviation
    const header = ['meal_name', ...PACKAGE_TYPES.map(pt => PACKAGE_LABELS[pt])].join(',');

    // One row per meal, with current par level in each package column
    const rows = mealGroups.map(group => {
      const cols = [group.mealName];
      PACKAGE_TYPES.forEach(pt => {
        const sku = group.skusByType[pt];
        if (sku) {
          const par = parBySkuId[sku.id];
          cols.push(par ? String(par.par_level) : '0');
        } else {
          cols.push('');
        }
      });
      return cols.join(',');
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

    // Parse header to find package type columns
    const header = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
    const mealColIdx = header.findIndex(h => h.toLowerCase().includes('meal'));
    if (mealColIdx === -1) {
      toast.error('CSV must have a "meal_name" column');
      setImporting(false);
      return;
    }

    // Map header columns to package types by matching abbreviations
    const labelToType = {};
    PACKAGE_TYPES.forEach(pt => { labelToType[PACKAGE_LABELS[pt].toLowerCase()] = pt; });

    const colPackageMap = {}; // colIndex -> package_type
    header.forEach((h, idx) => {
      if (idx === mealColIdx) return;
      const match = labelToType[h.trim().toLowerCase()];
      if (match) colPackageMap[idx] = match;
    });

    if (Object.keys(colPackageMap).length === 0) {
      toast.error('No package type columns found. Use abbreviations: ' + PACKAGE_TYPES.map(pt => PACKAGE_LABELS[pt]).join(', '));
      setImporting(false);
      return;
    }

    // Build a lookup: mealName (lowercase) -> { packageType -> sku }
    const mealGroups = groupSkusByMeal(skus, meals);
    const mealLookup = {};
    mealGroups.forEach(g => { mealLookup[g.mealName.toLowerCase()] = g; });

    const today = format(new Date(), 'yyyy-MM-dd');
    let matched = 0;
    let unmatched = 0;

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map(c => c.trim().replace(/"/g, ''));
      const mealName = cols[mealColIdx]?.trim();
      if (!mealName) continue;

      const group = mealLookup[mealName.toLowerCase()];
      if (!group) { unmatched++; continue; }

      for (const [colIdxStr, pt] of Object.entries(colPackageMap)) {
        const val = parseInt(cols[Number(colIdxStr)], 10);
        if (isNaN(val)) continue;

        const sku = group.skusByType[pt];
        if (!sku) continue;

        const existing = parBySkuId[sku.id];
        if (existing) {
          await base44.entities.ParLevel.update(existing.id, {
            par_level: val,
            effective_from: today,
          });
        } else {
          await base44.entities.ParLevel.create({
            sku_id: sku.id,
            sku_display_name: sku.display_name || '',
            package_type: sku.package_type || '',
            par_level: val,
            effective_from: today,
          });
        }
        matched++;
      }
    }

    queryClient.invalidateQueries({ queryKey: ['parLevels'] });
    setResult({ matched, unmatched });
    toast.success(`Imported par levels for ${matched} SKUs`);
    setImporting(false);
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold">CSV Par Level Import</h3>
          <p className="text-xs text-muted-foreground">
            Download the sample CSV with all meals pre-filled, update par levels, then re-upload
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <input ref={fileRef} type="file" accept=".csv" onChange={handleFileSelect} className="hidden" />
        <Button variant="outline" size="sm" onClick={handleDownloadSample} className="gap-2">
          <Download className="w-3.5 h-3.5" />
          Download Sample CSV
        </Button>
        <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={importing} className="gap-2">
          <Upload className="w-3.5 h-3.5" />
          {importing ? 'Importing...' : 'Upload CSV'}
        </Button>

        {result && (
          <div className="flex items-center gap-2 text-xs">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
            <span className="text-emerald-700">{result.matched} updated</span>
            {result.unmatched > 0 && (
              <>
                <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                <span className="text-amber-600">{result.unmatched} meals not found</span>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}