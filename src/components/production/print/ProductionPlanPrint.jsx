import React from 'react';
import { format } from 'date-fns';

// Range column hexes — mirror VARIANT_INFO / RING_COLORS so print keeps the
// app's package identity (blue → green → orange → pink).
const COL_HEX = { MWL: '#3b82f6', MLM: '#22c55e', WLM: '#f97316', WWL: '#f472b6' };
const exact = { WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' };

function Header({ title, accent = '#1e293b', meta }) {
  return (
    <div className="flex justify-between items-start mb-3">
      <div className="flex items-center gap-3">
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-lg shrink-0"
          style={{ backgroundColor: accent, ...exact }}
        >
          LL
        </div>
        <div>
          <h1 className="text-xl font-extrabold tracking-tight leading-none">{title}</h1>
          {meta && <p className="text-[11px] text-gray-500 mt-1">{meta}</p>}
        </div>
      </div>
      <div className="text-[11px] text-gray-700 text-right leading-6">
        <div>DATE: <span className="inline-block border-b border-gray-400 w-28" /></div>
        <div>RUN / BATCH NO.: <span className="inline-block border-b border-gray-400 w-20" /></div>
      </div>
    </div>
  );
}

/** Goal-meals grid: dishes as rows, ranges as columns. */
function GoalPage({ run, goal }) {
  const runDate = run?.run_date ? format(new Date(run.run_date), 'dd MMM yyyy') : '';
  return (
    <section className="print-page">
      <Header
        title="PRODUCTION PLAN SHEET"
        meta={`Goal Ranges${runDate ? ' · ' + runDate : ''} · ${run?.run_number || ''}`}
      />
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            <th className="text-left px-3 py-2 text-white font-bold text-xs"
                style={{ backgroundColor: '#1e293b', ...exact }}>MEAL (DISH)</th>
            {goal.columns.map(col => (
              <th key={col.code} className="px-2 py-2 text-white font-bold text-xs text-center w-28"
                  style={{ backgroundColor: COL_HEX[col.code], ...exact }}>
                <div className="leading-tight">{col.label.toUpperCase()}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {goal.rows.map((r, i) => (
            <tr key={r.mealNumber} style={i % 2 ? { backgroundColor: '#f8fafc', ...exact } : undefined}>
              <td className="px-3 py-1.5 border-b border-gray-200 font-medium">{r.name}</td>
              {goal.columns.map(col => (
                <td key={col.code} className="px-2 py-1.5 border-b border-gray-200 text-center tabular-nums">
                  {r.cells[col.code] === null
                    ? <span className="text-gray-300">–</span>
                    : <span className={r.cells[col.code] === 0 ? 'text-gray-300' : 'font-semibold'}>{r.cells[col.code]}</span>}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td className="px-3 py-2 font-bold text-right text-xs uppercase tracking-wide">Total per range</td>
            {goal.columns.map(col => (
              <td key={col.code} className="px-2 py-2 text-center font-extrabold text-white tabular-nums"
                  style={{ backgroundColor: COL_HEX[col.code], ...exact }}>
                {goal.totals[col.code]}
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
      <p className="text-right text-xs text-gray-600 mt-2">
        Grand total: <strong className="tabular-nums">{goal.grandTotal}</strong> meals
      </p>
    </section>
  );
}

/** A single-column qty page (Low Carb, Winter Warmer, Other). */
function SingleColumnPage({ run, title, accent, rows, total, meta }) {
  const runDate = run?.run_date ? format(new Date(run.run_date), 'dd MMM yyyy') : '';
  return (
    <section className="print-page">
      <Header title={title} accent={accent} meta={`${meta}${runDate ? ' · ' + runDate : ''} · ${run?.run_number || ''}`} />
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            <th className="text-left px-3 py-2 text-white font-bold text-xs"
                style={{ backgroundColor: '#1e293b', ...exact }}>MEAL (DISH)</th>
            <th className="px-2 py-2 text-white font-bold text-xs text-center w-32"
                style={{ backgroundColor: accent, ...exact }}>QTY TO PLATE</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.sku || r.name} style={i % 2 ? { backgroundColor: '#f8fafc', ...exact } : undefined}>
              <td className="px-3 py-1.5 border-b border-gray-200 font-medium">{r.name}</td>
              <td className="px-2 py-1.5 border-b border-gray-200 text-center font-semibold tabular-nums">{r.qty}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td className="px-3 py-2 font-bold text-right text-xs uppercase tracking-wide">Total</td>
            <td className="px-2 py-2 text-center font-extrabold text-white tabular-nums"
                style={{ backgroundColor: accent, ...exact }}>{total}</td>
          </tr>
        </tfoot>
      </table>
    </section>
  );
}

export default function ProductionPlanPrint({ run, plan }) {
  if (!plan) return null;
  return (
    <div className="print-root text-gray-900">
      {plan.goal.rows.length > 0 && <GoalPage run={run} goal={plan.goal} />}
      {plan.lowCarb.rows.length > 0 && (
        <SingleColumnPage run={run} title="PRODUCTION PLAN — LOW CARB" accent="#facc15"
          meta="Low Carb Package" rows={plan.lowCarb.rows} total={plan.lowCarb.total} />
      )}
      {plan.winter.rows.length > 0 && (
        <SingleColumnPage run={run} title="PRODUCTION PLAN — WINTER WARMER" accent="#ef4444"
          meta="Winter Warmer Range" rows={plan.winter.rows} total={plan.winter.total} />
      )}
      {plan.other.rows.length > 0 && (
        <SingleColumnPage run={run} title="PRODUCTION PLAN — OTHER MEALS" accent="#64748b"
          meta="Other Meals" rows={plan.other.rows} total={plan.other.total} />
      )}
      {plan.goal.rows.length === 0 && plan.lowCarb.rows.length === 0 &&
       plan.winter.rows.length === 0 && plan.other.rows.length === 0 && (
        <p className="text-sm text-gray-500 py-8 text-center">No meals on this run.</p>
      )}
    </div>
  );
}
