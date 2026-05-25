/**
 * Attempts to infer a UoM from a Xero line item description.
 * Returns a short code like 'kg', 'L', 'pcs', 'box', or null if no hint found.
 *
 * Patterns detected:
 *   P/KG, /KG, PER KG         → kg
 *   P/L, /L, PER LITRE        → L
 *   EACH                       → pcs
 *   10x1kg, 24x500g            → box (case/carton of sub-units)
 */
export function parseUomFromDescription(description) {
  if (!description) return null;
  const d = description.toUpperCase();

  // Per-kilogram patterns
  if (/P\/KG|\/KG|PER\s*KG|PER\s*KILO/i.test(d)) return 'kg';

  // Per-gram patterns
  if (/P\/G\b|\/G\b|PER\s*GRAM/i.test(d)) return 'g';

  // Per-litre patterns
  if (/P\/L\b|\/L\b|PER\s*LIT/i.test(d)) return 'L';

  // Per-ml patterns
  if (/P\/ML|\/ML|PER\s*ML/i.test(d)) return 'ml';

  // "EACH" — count-based
  if (/\bEACH\b/i.test(d)) return 'pcs';

  // Carton/box pattern: "10x1kg", "24x500g", "6x2L"
  if (/\d+\s*[xX]\s*\d+\s*(kg|g|l|ml)\b/i.test(d)) return 'box';

  return null;
}