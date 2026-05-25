import React, { useMemo } from 'react';

function netByProduct(movements) {
  const map = {};
  for (const m of movements) {
    const key = m.product_id || m.product_sku;
    if (!map[key]) map[key] = { qty: 0 };
    map[key].qty += m.qty;
  }
  return Object.values(map).filter(r => r.qty > 0.001);
}

export default function CompletionKPIStrip({ lines, actuals, movements, wipBatches, productTypeMap }) {
  const totalPlanned = lines.reduce((s, l) => s + l.planned_qty, 0);
  const totalActual = lines.reduce((s, l) => s + (Number(actuals[l.id]) || 0), 0);

  const { totalRawReturnQty, totalWasteQty, totalWasteCost } = useMemo(() => {
    const returnMvs = movements.filter(m => m.reason === 'return' && productTypeMap[m.product_id] === 'raw');
    const wastageMvs = movements.filter(m => m.reason === 'wastage_unusable' || m.reason === 'wastage_usable');
    return {
      totalRawReturnQty: netByProduct(returnMvs).reduce((s, r) => s + r.qty, 0),
      totalWasteQty: netByProduct(wastageMvs).reduce((s, r) => s + r.qty, 0),
      totalWasteCost: wastageMvs.reduce((s, m) => s + (m.qty || 0) * (m.unit_cost_at_movement || 0), 0),
    };
  }, [movements, productTypeMap]);

  const totalWipLeftover = wipBatches
    .filter(b => (b.qty_kg || 0) > 0.001)
    .reduce((s, b) => s + b.qty_kg, 0);

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <div className="bg-green-50 dark:bg-green-900/20 rounded-xl p-4 text-center">
        <p className="text-2xl font-bold text-green-700 dark:text-green-400 tabular-nums">{totalActual}</p>
        <p className="text-xs text-green-600">Meals Produced</p>
        {totalActual !== totalPlanned && (
          <p className="text-[10px] text-muted-foreground mt-0.5">of {totalPlanned} planned</p>
        )}
      </div>
      <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-4 text-center">
        <p className="text-2xl font-bold text-blue-700 dark:text-blue-400 tabular-nums">{totalWipLeftover.toFixed(1)}</p>
        <p className="text-xs text-blue-600">Bulk Leftover (kg)</p>
      </div>
      <div className="bg-amber-50 dark:bg-amber-900/20 rounded-xl p-4 text-center">
        <p className="text-2xl font-bold text-amber-700 dark:text-amber-400 tabular-nums">{totalRawReturnQty.toFixed(1)}</p>
        <p className="text-xs text-amber-600">Raw Returned</p>
      </div>
      <div className="bg-red-50 dark:bg-red-900/20 rounded-xl p-4 text-center">
        <p className="text-2xl font-bold text-red-700 dark:text-red-400 tabular-nums">{totalWasteQty.toFixed(1)}</p>
        <p className="text-xs text-red-600">Wastage</p>
        {totalWasteCost > 0.01 && (
          <p className="text-[10px] text-red-500 mt-0.5">R{totalWasteCost.toFixed(2)}</p>
        )}
      </div>
    </div>
  );
}