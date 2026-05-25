import React, { useState, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Upload, FileUp, CheckCircle2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';

export default function CSVStockImport({ skus }) {
  const queryClient = useQueryClient();
  const fileRef = useRef(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);

  const skuByCode = {};
  skus.forEach(s => { skuByCode[s.sku_code?.toLowerCase()] = s; });

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

    // Parse header
    const header = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/"/g, ''));
    const skuColIdx = header.findIndex(h => h.includes('sku') || h.includes('code'));
    const stockColIdx = header.findIndex(h => h.includes('stock') || h.includes('quantity') || h.includes('qty') || h.includes('on_hand'));

    if (skuColIdx === -1 || stockColIdx === -1) {
      toast.error('CSV must have columns for SKU code and stock quantity');
      setImporting(false);
      return;
    }

    const today = format(new Date(), 'yyyy-MM-dd');
    const records = [];
    let matched = 0;
    let unmatched = 0;

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map(c => c.trim().replace(/"/g, ''));
      const skuCode = cols[skuColIdx]?.toLowerCase();
      const stockVal = parseInt(cols[stockColIdx], 10);

      if (!skuCode || isNaN(stockVal)) continue;

      const sku = skuByCode[skuCode];
      if (sku) {
        records.push({
          snapshot_date: today,
          sku_id: sku.id,
          sku_display_name: sku.display_name || '',
          package_type: sku.package_type || '',
          stock_on_hand: stockVal,
          entry_type: 'csv_import',
        });
        matched++;
      } else {
        unmatched++;
      }
    }

    if (records.length > 0) {
      // Bulk create in batches
      for (let i = 0; i < records.length; i += 50) {
        await base44.entities.StockSnapshot.bulkCreate(records.slice(i, i + 50));
      }
    }

    queryClient.invalidateQueries({ queryKey: ['latestStock'] });
    setResult({ matched, unmatched, total: lines.length - 1 });
    toast.success(`Imported stock for ${matched} SKUs`);
    setImporting(false);
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className="flex items-center gap-3 mb-3">
        <FileUp className="w-5 h-5 text-muted-foreground" />
        <div>
          <h3 className="text-sm font-semibold">CSV Stock Import</h3>
          <p className="text-xs text-muted-foreground">Upload a CSV with columns: sku_code, stock_on_hand</p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <input
          ref={fileRef}
          type="file"
          accept=".csv"
          onChange={handleFileSelect}
          className="hidden"
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() => fileRef.current?.click()}
          disabled={importing}
          className="gap-2"
        >
          <Upload className="w-3.5 h-3.5" />
          {importing ? 'Importing...' : 'Choose CSV File'}
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