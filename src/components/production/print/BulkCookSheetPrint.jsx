import React from 'react';
import { format } from 'date-fns';

const exact = { WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' };

// Column accent colours mirror the mockup: raw=blue, cooked=green, yield=amber, diff=red.
const COL = {
  raw: '#2563eb',
  cooked: '#16a34a',
  yield: '#d97706',
  diff: '#dc2626',
};

/**
 * Bulk Cook Sheet — per bulk product the Raw vs Cooked weight required for the
 * run, with a blank Actual-Yield write-in and Difference column the kitchen fills.
 */
export default function BulkCookSheetPrint({ run, bulkCook }) {
  if (!bulkCook) return null;
  const runDate = run?.run_date ? format(new Date(run.run_date), 'dd MMM yyyy') : '';
  const rows = bulkCook.rows || [];

  return (
    <div className="print-root text-gray-900">
      <section className="print-page">
        <div className="flex justify-between items-start mb-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-lg shrink-0"
                 style={{ backgroundColor: '#1e293b', ...exact }}>LL</div>
            <div>
              <h1 className="text-xl font-extrabold tracking-tight leading-none">BULK COOK SHEET</h1>
              <p className="text-[11px] text-gray-500 mt-1">
                Raw &amp; Cooked Weight Required{runDate ? ' · ' + runDate : ''} · {run?.run_number || ''}
              </p>
            </div>
          </div>
          <div className="text-[11px] text-gray-700 text-right leading-6">
            <div>DATE: <span className="inline-block border-b border-gray-400 w-28" /></div>
            <div>BATCH / RUN NO.: <span className="inline-block border-b border-gray-400 w-20" /></div>
          </div>
        </div>

        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="text-left px-3 py-2 text-white font-bold text-xs"
                  style={{ backgroundColor: '#1e293b', ...exact }}>BULK PRODUCT</th>
              <th className="px-2 py-2 text-white font-bold text-[11px] text-center w-28"
                  style={{ backgroundColor: COL.raw, ...exact }}>RAW WEIGHT<br />(kg)</th>
              <th className="px-2 py-2 text-white font-bold text-[11px] text-center w-28"
                  style={{ backgroundColor: COL.cooked, ...exact }}>COOKED REQUIRED<br />(kg)</th>
              <th className="px-2 py-2 text-white font-bold text-[11px] text-center w-28"
                  style={{ backgroundColor: COL.yield, ...exact }}>ACTUAL YIELD<br />(kg)</th>
              <th className="px-2 py-2 text-white font-bold text-[11px] text-center w-28"
                  style={{ backgroundColor: COL.diff, ...exact }}>DIFFERENCE<br />(kg)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.sku || r.name} style={i % 2 ? { backgroundColor: '#f8fafc', ...exact } : undefined}>
                <td className="px-3 py-2 border-b border-gray-200 font-medium">
                  {r.name}
                  {r.sku && <span className="text-gray-400 font-mono text-[10px] ml-1">{r.sku}</span>}
                </td>
                <td className="px-2 py-2 border-b border-gray-200 text-center font-semibold tabular-nums"
                    style={{ color: COL.raw }}>{r.rawKg ? r.rawKg.toFixed(2) : '—'}</td>
                <td className="px-2 py-2 border-b border-gray-200 text-center font-semibold tabular-nums"
                    style={{ color: COL.cooked }}>{r.cookedKg.toFixed(2)}</td>
                {/* blank write-in */}
                <td className="px-2 py-2 border-b border-gray-200" />
                <td className="px-2 py-2 border-b border-gray-200" />
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-bold">
              <td className="px-3 py-2 text-right text-xs uppercase tracking-wide">Total</td>
              <td className="px-2 py-2 text-center tabular-nums text-white" style={{ backgroundColor: COL.raw, ...exact }}>
                {bulkCook.totalRawKg ? bulkCook.totalRawKg.toFixed(2) : '—'}
              </td>
              <td className="px-2 py-2 text-center tabular-nums text-white" style={{ backgroundColor: COL.cooked, ...exact }}>
                {bulkCook.totalCookedKg.toFixed(2)}
              </td>
              <td className="px-2 py-2" style={{ backgroundColor: '#fffbeb', ...exact }} />
              <td className="px-2 py-2" style={{ backgroundColor: '#fef2f2', ...exact }} />
            </tr>
          </tfoot>
        </table>

        {rows.length === 0 && (
          <p className="text-sm text-gray-500 py-8 text-center">
            No bulk products to cook for this run (the meals have no Cook BOMs).
          </p>
        )}

        <div className="text-[11px] text-gray-500 mt-4 border-t pt-2 flex justify-between">
          <span>Cooked by: ____________________   Checked: ____________________</span>
          <span>Printed {format(new Date(), 'dd MMM yyyy HH:mm')}</span>
        </div>
      </section>
    </div>
  );
}
