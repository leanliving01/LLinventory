/**
 * Product roles — the single source of truth for what a product is allowed to
 * do in the system. A product plays one or more of three independent roles:
 *
 *   sellable    → sold to customers (Shopify sync + manual sales orders).
 *                 Owns: selling price, revenue account, sale tax rule.
 *   purchasable → bought from suppliers (purchase orders, supplier invoices,
 *                 GRN, supplier-product links).
 *                 Owns: supplier links, purchase UoM, purchase tax rule, cost.
 *   produced    → made in-house during production (carries a BOM / recipe).
 *
 * Invariant: every product must have at least one role, and a sellable product
 * must be sourced somehow — i.e. purchasable OR produced.
 *
 * These map to three boolean columns on `products`: sellable, purchasable,
 * produced. Read them ONLY through the helpers below so every surface
 * (sales picker, PO picker, supplier links, BOM eligibility, the product form)
 * agrees. Do not re-derive a role from `type` in calling code — seed defaults
 * from type here, then let the stored flags be authoritative.
 */

// ── Role predicates ─────────────────────────────────────────────────────────
// `purchasable` historically defaulted to true, so treat null/undefined as
// purchasable for backward safety; sellable/produced default to false.
export function isSellable(p)    { return p?.sellable === true; }
export function isPurchasable(p) { return p?.purchasable !== false; }
export function isProduced(p)    { return p?.produced === true; }

/** Roles object for convenience: { sellable, purchasable, produced }. */
export function getRoles(p) {
  return { sellable: isSellable(p), purchasable: isPurchasable(p), produced: isProduced(p) };
}

// ── Type → default roles ────────────────────────────────────────────────────
// Which categories are made in-house (carry a production or packing BOM)…
export const PRODUCED_TYPES = ['wip_bulk', 'finished_meal', 'sauce', 'solo_serve', 'package', 'bundle'];
// …which are bought from suppliers (eligible for POs / supplier invoices)…
export const PURCHASABLE_TYPES = ['raw', 'packaging', 'supplement', 'sauce', 'service'];
// …and which are sold to customers by default (others can still be toggled on).
export const SELLABLE_TYPES = ['supplement', 'package', 'bundle', 'solo_serve'];

/**
 * The default role flags to seed when a product is created in a given category.
 * Returned as explicit booleans so the form can pre-fill all three toggles; the
 * user remains free to override any of them.
 */
export function defaultRolesForType(type) {
  return {
    sellable: SELLABLE_TYPES.includes(type),
    purchasable: PURCHASABLE_TYPES.includes(type),
    produced: PRODUCED_TYPES.includes(type),
  };
}

/** Human label for a role key — used in form hints / chips. */
export const ROLE_LABELS = {
  sellable: 'Sellable',
  purchasable: 'Purchasable',
  produced: 'Produced In-House',
};
