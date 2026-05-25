import React from 'react';
import { format } from 'date-fns';

const CATEGORY_ORDER = [
  'Meats', 'Vegetables', 'Starches', 'Spices & Seasoning',
  'Sauces & Condiments', 'Dairy & Eggs', 'Oils & Fats',
  'Dry Goods', 'Packaging', 'Other', 'Uncategorized',
];

/**
 * Print-specific layout reading from PickLine entities.
 */
export default function PickListPrintView({ run, lines, pickLines, categories }) {
  if (!run || !pickLines.length) return null;

  const hasPickedQty = pickLines.some(pl => pl.actual_qty_picked > 0);
  const runDate = run.run_date ? format(new Date(run.run_date), 'dd MMM yyyy') : '—';

  // Group by category
  const byCategory = {};
  pickLines.forEach(pl => {
    const cat = pl.category_group || 'Uncategorized';
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(pl);
  });
  const sortedCats = categories.length > 0 ? categories : Object.keys(byCategory).sort((a, b) => CATEGORY_ORDER.indexOf(a) - CATEGORY_ORDER.indexOf(b));

  return (
    <div className="hidden print:block">
      {/* Header */}
      <div className="flex justify-between items-end mb-4">
        <div>
          <h1 className="text-xl font-bold">PICK LIST — {run.run_number}</h1>
          <p className="text-sm text-gray-600">{runDate} · {lines.length} meals · {pickLines.length} ingredients</p>
        </div>
        <p className="text-xs text-gray-500">Printed {format(new Date(), 'dd MMM yyyy HH:mm')}</p>
      </div>

      {/* Signature line */}
      <div className="text-xs text-gray-500 mb-4 border-b pb-2">
        Picked by: ________________________   Checked: ________________________   Time: _________
      </div>

      {/* Tables */}
      {sortedCats.map(cat => {
        const items = byCategory[cat];
        if (!items || items.length === 0) return null;
        return (
          <div key={cat} className="mb-4 break-inside-avoid">
            <div className="bg-gray-100 px-2 py-1 font-bold text-sm border-b">{cat} ({items.length})</div>
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b">
                  <th className="w-6 py-1"></th>
                  <th className="text-left py-1 px-1 font-medium">SKU</th>
                  <th className="text-left py-1 px-1 font-medium">Ingredient</th>
                  <th className="text-left py-1 px-1 font-medium">Location</th>
                  <th className="text-right py-1 px-1 font-medium">Needed</th>
                  {hasPickedQty && <th className="text-right py-1 px-1 font-medium">Picked</th>}
                  <th className="text-left py-1 px-1 font-medium">UoM</th>
                </tr>
              </thead>
              <tbody>
                {items.map(pl => (
                  <tr key={pl.id} className="border-b border-gray-200 leading-6">
                    <td className="py-0.5 px-1">
                      <div className={`w-4 h-4 border-2 border-black rounded ${pl.status !== 'not_picked' ? 'bg-green-500' : ''}`} />
                    </td>
                    <td className="py-0.5 px-1 font-mono text-gray-500">{pl.product_sku}</td>
                    <td className="py-0.5 px-1 font-medium">{pl.product_name}</td>
                    <td className="py-0.5 px-1 text-gray-500">{pl.from_location_name || '—'}</td>
                    <td className="py-0.5 px-1 text-right font-bold tabular-nums">{pl.required_qty}</td>
                    {hasPickedQty && (
                      <td className="py-0.5 px-1 text-right tabular-nums text-green-700 font-bold">
                        {pl.actual_qty_picked > 0 ? pl.actual_qty_picked : '—'}
                      </td>
                    )}
                    <td className="py-0.5 px-1 text-gray-500">{pl.required_uom}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}

      {/* Footer */}
      <div className="fixed bottom-0 left-0 right-0 text-xs text-gray-400 text-center py-1">
        Lean Living — {run.run_number}
      </div>
    </div>
  );
}