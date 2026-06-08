// Natural ("human") ordering so SKUs sort MLM1, MLM2 … MLM9, MLM10, MLM11
// instead of the default lexicographic MLM1, MLM10, MLM11, MLM2.

/** Compare two values with numeric-aware ordering. */
export function compareNatural(a, b) {
  return String(a ?? '').localeCompare(String(b ?? ''), undefined, {
    numeric: true,
    sensitivity: 'base',
  });
}

/** Comparator that natural-sorts objects by their `sku` field. */
export const bySku = (a, b) => compareNatural(a?.sku, b?.sku);

/** Comparator factory: natural-sort objects by an arbitrary field. */
export const byField = (field) => (a, b) => compareNatural(a?.[field], b?.[field]);
