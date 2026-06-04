import React from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Lock, Download } from 'lucide-react';
import { format } from 'date-fns';
import { formatZAR } from '@/lib/utils';
import StockCountVarianceTable from '@/components/stock-count/StockCountVarianceTable';

const fmtQty = (n) => {
  const v = Number(n) || 0;
  return Number.isInteger(v) ? String(v) : v.toFixed(3).replace(/\.?0+$/, '');
};

const fmtDateTime = (v) => (v ? format(new Date(v), 'dd MMM yyyy HH:mm') : '—');
const fmtDate = (v) => (v ? format(new Date(v), 'dd MMM yyyy') : '—');

function escapeCSV(val) {
  const str = String(val ?? '');
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

const CSV_HEADERS = [
  'reference', 'sku', 'product', 'location', 'system_qty', 'counted_qty', 'count_uom',
  'conversion_factor', 'converted_qty', 'variance_qty', 'unit_cost', 'variance_value',
];

/**
 * Locked, immutable final report for a completed (posted) stock count.
 * `rows` come from buildVarianceRows(); `header` is the new_stock_takes record.
 */
export default function LockedCountReport({ header, rows, multiLocation = false }) {
  const counter = header.assigned_to_name || header.submitted_by || '—';
  const totalVariance =
    header.total_variance_rand != null
      ? Number(header.total_variance_rand)
      : rows.reduce((s, r) => s + (Number(r._varianceValue) || 0), 0);

  const handleExport = () => {
    const lines = [CSV_HEADERS.join(',')];
    rows.forEach(r => {
      lines.push([
        escapeCSV(header.reference || header.id),
        escapeCSV(r.product_sku),
        escapeCSV(r.product_name),
        escapeCSV(r.location_name || ''),
        fmtQty(r._system),
        fmtQty(r.counted_qty),
        escapeCSV(r.count_uom || r.stock_uom || ''),
        fmtQty(Number(r.conversion_factor) || 1),
        fmtQty(r._converted),
        fmtQty(r._variance),
        Number(r._unitCost) || 0,
        Number(r._varianceValue) || 0,
      ].join(','));
    });

    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `stock_count_${header.reference || header.id}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      {/* Locked final report header */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-3 bg-muted/40 border-b border-border">
          <Lock className="w-4 h-4 text-muted-foreground" />
          <span className="font-semibold text-sm">Final Variance Report</span>
          <Badge className="text-[10px] bg-green-100 text-green-700">Locked</Badge>
          <span className="ml-auto">
            <Button variant="outline" size="sm" onClick={handleExport} className="gap-1.5">
              <Download className="w-4 h-4" /> Export CSV
            </Button>
          </span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-3 px-5 py-4 text-sm">
          <Field label="Reference" value={header.reference || header.id.slice(0, 8)} mono />
          <Field label="Date" value={fmtDate(header.stocktake_date)} />
          <Field label="Location" value={header.location_name || '—'} />
          <Field label="Count Type" value={header.count_type || '—'} />
          <Field label="Counted By" value={counter} />
          <Field label="Submitted" value={fmtDateTime(header.submitted_at)} />
          <Field label="Reviewed By" value={header.reviewed_by || '—'} />
          <Field label="Posted By" value={header.posted_by || '—'} />
          <Field label="Posted At" value={fmtDateTime(header.posted_at)} />
          <Field
            label="Total Variance Value"
            value={formatZAR(totalVariance)}
            className={totalVariance < 0 ? 'text-red-600' : 'text-foreground'}
          />
        </div>
      </div>

      <StockCountVarianceTable rows={rows} showConversion showLocation={multiLocation} />

      <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
        <Lock className="w-3 h-3" /> This report is locked and immutable. Stock-on-hand was updated when it was posted.
      </p>
    </div>
  );
}

function Field({ label, value, mono = false, className = '' }) {
  return (
    <div>
      <p className="text-[10px] text-muted-foreground uppercase font-semibold">{label}</p>
      <p className={`font-medium ${mono ? 'font-mono' : ''} ${className}`}>{value}</p>
    </div>
  );
}
