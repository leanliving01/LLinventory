import React from 'react';
import { Button } from '@/components/ui/button';
import { Download } from 'lucide-react';

const CSV_HEADERS = ['sku', 'name', 'type', 'uom', 'on_hand', 'committed', 'available', 'reorder_point'];

function escapeCSV(val) {
  const str = String(val ?? '');
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

/**
 * Exports the current filtered inventory view to CSV with all data filled in.
 * Props:
 *  - products: filtered array of Product records
 *  - stockByProduct: { productId: { on_hand, committed, available } }
 */
export default function InventoryCSVExport({ products, stockByProduct }) {
  const handleExport = () => {
    const rows = [CSV_HEADERS.join(',')];

    products.forEach(p => {
      const stock = stockByProduct[p.id] || { on_hand: 0, committed: 0, available: 0 };
      const reorder = p.min_before_reorder || 0;
      rows.push([
        escapeCSV(p.sku),
        escapeCSV(p.name),
        escapeCSV(p.type),
        escapeCSV(p.stock_uom),
        stock.on_hand,
        stock.committed,
        stock.available,
        reorder,
      ].join(','));
    });

    const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const date = new Date().toISOString().slice(0, 10);
    a.download = `inventory_overview_${date}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Button variant="outline" size="sm" onClick={handleExport} className="gap-1.5">
      <Download className="w-4 h-4" /> Export CSV
    </Button>
  );
}