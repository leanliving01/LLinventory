/**
 * Tax rate resolution with priority order:
 * SupplierProduct default → Supplier default → system default (is_default = true)
 *
 * @param {object|null} supplierProduct - SupplierProduct record (may have default_tax_rate_id)
 * @param {object|null} supplier        - Supplier record (may have default_tax_rate_id)
 * @param {Array}       taxRates        - Array of all active TaxRate records
 * @returns {string|null} The resolved tax_rate_id
 */
export function resolveTaxRateId(supplierProduct, supplier, taxRates) {
  if (supplierProduct?.default_tax_rate_id) return supplierProduct.default_tax_rate_id;
  if (supplier?.default_tax_rate_id) return supplier.default_tax_rate_id;
  const defaultRate = taxRates?.find(r => r.is_default && r.active);
  return defaultRate?.id ?? null;
}

/**
 * Resolves the tax rate decimal (e.g. 0.15 for 15%) for a line.
 *
 * @param {object|null} supplierProduct
 * @param {object|null} supplier
 * @param {Array}       taxRates
 * @returns {number} Tax rate as a decimal (0.15, 0.00, etc.).
 *   Returns 0 if no rate is configured — DB migration seeds a default rate so this
 *   only fires if tax_rates table is empty (migration not yet applied).
 */
export function resolveTaxRate(supplierProduct, supplier, taxRates) {
  const id = resolveTaxRateId(supplierProduct, supplier, taxRates);
  if (!id) return 0;
  const found = taxRates?.find(r => r.id === id);
  return found?.rate ?? 0;
}

/**
 * Resolves the full TaxRate record for a line.
 *
 * @param {object|null} supplierProduct
 * @param {object|null} supplier
 * @param {Array}       taxRates
 * @returns {object|null} The resolved TaxRate record or null
 */
export function resolveTaxRateRecord(supplierProduct, supplier, taxRates) {
  const id = resolveTaxRateId(supplierProduct, supplier, taxRates);
  if (!id) return taxRates?.find(r => r.is_default && r.active) ?? null;
  return taxRates?.find(r => r.id === id) ?? null;
}

/**
 * Computes the effective inventory unit cost based on tax type.
 * - For claimable VAT (applies_to_vat = true): use EXCLUDING VAT cost
 * - For non-claimable (applies_to_vat = false): use INCLUDING VAT cost
 *
 * @param {number} costExclVat
 * @param {object} taxRate - TaxRate record with .rate and .applies_to_vat
 * @returns {number}
 */
export function inventoryCost(costExclVat, taxRate) {
  if (!taxRate || taxRate.applies_to_vat) return costExclVat;
  return costExclVat * (1 + (taxRate.rate ?? 0));
}
