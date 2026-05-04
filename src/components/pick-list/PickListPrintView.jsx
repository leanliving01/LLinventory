import React from 'react';
import { format } from 'date-fns';

/**
 * Print-only view that mirrors the PDF layout exactly.
 * Hidden on screen, visible when printing.
 */
export default function PickListPrintView({ run, lines, pickItems, categories, pickedState = {} }) {
  const hasPicked = pickItems.some(i => {
    const s = pickedState[i.product?.id];
    return s?.picked && s?.qty && Number(s.qty) > 0;
  });

  const runDate = run?.run_date ? format(new Date(run.run_date), 'dd MMM yyyy') : '—';

  return (
    <div className="hidden print:block text-black bg-white">
      {/* Header */}
      <div className="flex items-baseline justify-between mb-1">
        <h1 className="text-xl font-bold tracking-tight">PICK LIST</h1>
        <span className="text-sm font-medium">{run?.run_number}</span>
      </div>
      <div className="flex items-center justify-between text-[10px] text-gray-500 mb-1">
        <span>{runDate} · {lines.length} meals · {pickItems.length} ingredients</span>
        <span>Printed {format(new Date(), 'dd MMM yyyy HH:mm')}</span>
      </div>
      <hr className="border-black mb-2" />
      <p className="text-[9px] text-gray-400 mb-3">
        Picked by: ________________________ &nbsp;&nbsp; Checked: ________________________ &nbsp;&nbsp; Time: _________
      </p>

      {/* Categories */}
      {categories.map(cat => {
        const catItems = pickItems.filter(i => i.pickCategory === cat);
        if (catItems.length === 0) return null;

        return (
          <div key={cat} className="mb-3 break-inside-avoid">
            {/* Category header */}
            <div className="bg-gray-200 px-2 py-1 mb-0.5">
              <span className="text-[10px] font-bold">{cat} ({catItems.length})</span>
            </div>

            {/* Sub-header row */}
            <table className="w-full text-[9px]">
              <thead>
                <tr className="text-gray-400">
                  <th className="w-5"></th>
                  <th className="text-left pl-1 w-20">SKU</th>
                  <th className="text-left pl-1">Ingredient</th>
                  {hasPicked && <th className="text-right pr-1 w-16">Picked</th>}
                  <th className="text-right pr-1 w-16">Needed</th>
                  <th className="text-right pr-1 w-10">UoM</th>
                </tr>
              </thead>
              <tbody>
                {catItems.map(item => {
                  const ps = pickedState[item.product?.id];
                  const pickedQty = ps?.picked && ps?.qty ? Number(ps.qty) : 0;
                  const isPicked = pickedQty > 0;

                  return (
                    <tr key={item.product.id} className="leading-[14px] border-b border-gray-100">
                      <td className="py-[1px] pl-0.5">
                        {isPicked ? (
                          <div className="w-3 h-3 bg-green-700 border border-green-800 rounded-sm flex items-center justify-center">
                            <span className="text-white text-[7px] font-bold">✓</span>
                          </div>
                        ) : (
                          <div className="w-3 h-3 border border-gray-400 rounded-sm" />
                        )}
                      </td>
                      <td className="py-[1px] pl-1 font-mono text-[8px] text-gray-400">{item.product.sku}</td>
                      <td className="py-[1px] pl-1 text-[9px]">{item.product.name}</td>
                      {hasPicked && (
                        <td className={`py-[1px] pr-1 text-right font-bold tabular-nums ${isPicked ? 'text-green-800' : 'text-gray-300'}`}>
                          {isPicked ? pickedQty.toLocaleString() : '—'}
                        </td>
                      )}
                      <td className="py-[1px] pr-1 text-right font-bold tabular-nums">{item.totalQty.toLocaleString()}</td>
                      <td className="py-[1px] pr-1 text-right text-[8px] text-gray-400">{item.uom}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}

      {/* Footer */}
      <div className="fixed bottom-0 left-0 right-0 flex justify-between text-[8px] text-gray-300 px-3 pb-2">
        <span>Lean Living — {run?.run_number}</span>
      </div>
    </div>
  );
}