/**
 * Landed-cost (freight) allocation.
 *
 * Spreads one-off purchase charges (shipping, freight, customs…) across the
 * stock lines they were incurred for, so every received unit carries its share
 * of the charge — i.e. the cost is "landed". This is capitalised into the FIFO
 * cost layer + product cost at GRN confirmation (see GRNConfirmLogic.confirmGRN).
 * It is deliberately NOT added to the supplier unit price, so three-way match
 * and supplier-price history keep comparing the real per-item price.
 *
 * Allocation basis:
 *   'by_value' — proportional to each line's purchase value (received_qty × unit_cost)
 *   'by_qty'   — proportional to received_qty (in purchase UOM)
 *
 * @param lines  [{ key, received_qty, unit_cost }]  (unit_cost in purchase UOM)
 * @param chargesTotal  total charge amount to spread (net / excl. VAT)
 * @param method 'by_value' | 'by_qty'
 * @returns { [key]: { freightTotal, freightPerUnit } }  freightPerUnit is per PURCHASE unit
 *
 * Rounding: each line's freight is rounded to 2dp and the rounding remainder is
 * parked on the largest-share line, so Σ freightTotal === chargesTotal exactly
 * (no lost/created cents).
 */
export function allocateLandedCost(lines = [], chargesTotal = 0, method = 'by_value') {
  const out = {};
  for (const l of lines) out[l.key] = { freightTotal: 0, freightPerUnit: 0 };

  const amount = Number(chargesTotal) || 0;
  const eligible = lines.filter(l => (Number(l.received_qty) || 0) > 0);
  if (amount <= 0 || eligible.length === 0) return out;

  const basisOf = (l, m) => {
    const qty = Number(l.received_qty) || 0;
    return m === 'by_qty' ? qty : qty * (Number(l.unit_cost) || 0);
  };

  // by_value with all-zero costs can't allocate → fall back to by_qty so the
  // freight still lands somewhere sensible rather than silently vanishing.
  let useMethod = method === 'by_qty' ? 'by_qty' : 'by_value';
  let totalBasis = eligible.reduce((s, l) => s + basisOf(l, useMethod), 0);
  if (totalBasis <= 0 && useMethod === 'by_value') {
    useMethod = 'by_qty';
    totalBasis = eligible.reduce((s, l) => s + basisOf(l, useMethod), 0);
  }
  if (totalBasis <= 0) return out;

  let allocated = 0;
  const shares = eligible.map(l => {
    const raw = amount * (basisOf(l, useMethod) / totalBasis);
    const rounded = Math.round(raw * 100) / 100;
    allocated += rounded;
    return { l, rounded };
  });

  // Park the rounding remainder on the largest share so the total reconciles.
  const remainder = Math.round((amount - allocated) * 100) / 100;
  if (remainder !== 0) {
    let maxI = 0;
    for (let i = 1; i < shares.length; i++) if (shares[i].rounded > shares[maxI].rounded) maxI = i;
    shares[maxI].rounded = Math.round((shares[maxI].rounded + remainder) * 100) / 100;
  }

  for (const { l, rounded } of shares) {
    const qty = Number(l.received_qty) || 0;
    out[l.key] = { freightTotal: rounded, freightPerUnit: qty > 0 ? rounded / qty : 0 };
  }
  return out;
}
