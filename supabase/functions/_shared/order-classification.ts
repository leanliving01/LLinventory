// ============================================================================
// order-classification.ts
// Single source of truth for deciding whether an imported Shopify line / catalog
// item is a real inventory product or a non-inventory order-level entry
// (shipping, discount, voucher, store credit, refund, payment adjustment, tip).
//
// Only `inventory_product` lines link to the products master and deduct stock.
// Everything else becomes an order-level financial line on the sales order.
//
// Imported by sync-shopify-orders, shopify-webhook-handler, sync-shopify-products.
// ============================================================================

import { getSupabase } from './shopify.ts';

type SB = ReturnType<typeof getSupabase>;

export type LineCategory =
  | 'inventory_product'
  | 'shipping'
  | 'discount'
  | 'voucher'
  | 'store_credit'
  | 'refund'
  | 'payment_adjustment'
  | 'tip'
  | 'other';

export interface ClassificationRule {
  id: string;
  match_type: 'product_type' | 'sku_exact' | 'sku_prefix' | 'title_keyword' | 'title_regex';
  pattern: string; // matched case-insensitively
  classified_as: LineCategory;
  priority: number; // lower = evaluated first
}

// Minimal shapes of the Shopify payloads we read.
export interface ShopifyLineItemLike {
  id?: number | string;
  title?: string;
  sku?: string;
  product_type?: string;
  gift_card?: boolean;
  quantity?: number;
  price?: string;
}

export interface ShopifyShippingLine {
  id?: number | string;
  title?: string;
  price?: string;
  // deno-lint-ignore no-explicit-any
  tax_lines?: any[];
}

export interface ShopifyRefundLike {
  id?: number | string;
  // deno-lint-ignore no-explicit-any
  refund_line_items?: any[];
  // deno-lint-ignore no-explicit-any
  order_adjustments?: any[];
  // deno-lint-ignore no-explicit-any
  transactions?: any[];
  note?: string;
}

export interface ShopifyOrderLike {
  id?: number | string;
  order_number?: number | string;
  name?: string;
  total_discounts?: string;
  // deno-lint-ignore no-explicit-any
  discount_applications?: any[];
  // deno-lint-ignore no-explicit-any
  discount_codes?: any[];
  shipping_lines?: ShopifyShippingLine[];
  refunds?: ShopifyRefundLike[];
  // deno-lint-ignore no-explicit-any
  total_tip_received?: string;
}

export interface FinancialLineDraft {
  category: LineCategory;
  label: string;
  amount: number; // absolute value
  sign: 1 | -1; // +1 charge (adds to what the customer pays); -1 reduces revenue
  tax_amount: number;
  source: 'shopify';
  external_ref: string | null;
  matched_rule_id: string | null;
  // deno-lint-ignore no-explicit-any
  raw_payload: any;
}

// Load active rules ordered so the lowest priority is evaluated first.
export async function loadClassificationRules(supabase: SB): Promise<ClassificationRule[]> {
  const { data, error } = await supabase
    .from('sales_line_classification_rules')
    .select('id, match_type, pattern, classified_as, priority')
    .eq('active', true)
    .order('priority', { ascending: true });
  if (error) {
    console.error('loadClassificationRules error:', error.message);
    return [];
  }
  return (data || []) as ClassificationRule[];
}

function ruleMatches(rule: ClassificationRule, sku: string, title: string, productType: string): boolean {
  const p = rule.pattern.toLowerCase();
  switch (rule.match_type) {
    case 'product_type': return !!productType && productType.toLowerCase() === p;
    case 'sku_exact':    return !!sku && sku.toLowerCase() === p;
    case 'sku_prefix':   return !!sku && sku.toLowerCase().startsWith(p);
    case 'title_keyword':return !!title && title.toLowerCase().includes(p);
    case 'title_regex':  {
      try { return new RegExp(rule.pattern, 'i').test(title); } catch { return false; }
    }
    default: return false;
  }
}

// Classify a single order line_item (or catalog variant).
// Structural signal first (gift_card), then rules, then default.
export function classifyLineItem(
  li: ShopifyLineItemLike,
  rules: ClassificationRule[],
): { category: LineCategory; label: string; matchedRuleId: string | null } {
  const title = li.title || '';
  const sku = li.sku || '';
  const productType = li.product_type || '';

  if (li.gift_card === true) {
    return { category: 'voucher', label: title || 'Gift card', matchedRuleId: null };
  }

  for (const rule of rules) {
    if (ruleMatches(rule, sku, title, productType)) {
      return { category: rule.classified_as, label: title || rule.pattern, matchedRuleId: rule.id };
    }
  }

  // Default: a SKU-bearing line with no matching rule is a real inventory product.
  // A line with no SKU and no rule match is an unknown non-inventory entry.
  if (sku) return { category: 'inventory_product', label: title, matchedRuleId: null };
  return { category: 'other', label: title || 'Unclassified line', matchedRuleId: null };
}

function num(v: unknown): number {
  const n = parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : 0;
}

// deno-lint-ignore no-explicit-any
function sumTaxLines(taxLines: any[] | undefined): number {
  if (!Array.isArray(taxLines)) return 0;
  return taxLines.reduce((acc, t) => acc + num(t?.price), 0);
}

// Derive order-level financial lines from structural Shopify fields that are
// NOT line_items: shipping_lines, total_discounts, tips, and refunds that have
// no refund_line_items (shipping-only / manual refunds). Line-item refunds are
// handled by the Returns module and must NOT be duplicated here.
export function deriveOrderFinancialLines(
  order: ShopifyOrderLike,
  _rules: ClassificationRule[],
): FinancialLineDraft[] {
  const drafts: FinancialLineDraft[] = [];

  // Shipping — one financial line per shipping_line (free shipping recorded at 0).
  for (const sl of order.shipping_lines || []) {
    drafts.push({
      category: 'shipping',
      label: sl.title || 'Shipping',
      amount: num(sl.price),
      sign: 1,
      tax_amount: sumTaxLines(sl.tax_lines),
      source: 'shopify',
      external_ref: sl.id != null ? String(sl.id) : null,
      matched_rule_id: null,
      raw_payload: sl,
    });
  }

  // Discounts — aggregate order-level discount (per-line discounts are netted
  // into product lines, not duplicated here).
  const totalDiscounts = num(order.total_discounts);
  if (totalDiscounts > 0) {
    const code = (order.discount_codes && order.discount_codes[0]?.code) || null;
    drafts.push({
      category: 'discount',
      label: code ? `Discount (${code})` : 'Order discount',
      amount: totalDiscounts,
      sign: -1,
      tax_amount: 0,
      source: 'shopify',
      external_ref: null, // aggregate — unique key coalesces null
      matched_rule_id: null,
      raw_payload: { total_discounts: order.total_discounts, discount_codes: order.discount_codes },
    });
  }

  // Tip
  const tip = num(order.total_tip_received);
  if (tip > 0) {
    drafts.push({
      category: 'tip',
      label: 'Tip',
      amount: tip,
      sign: 1,
      tax_amount: 0,
      source: 'shopify',
      external_ref: null,
      matched_rule_id: null,
      raw_payload: { total_tip_received: order.total_tip_received },
    });
  }

  // Refunds WITHOUT refund_line_items → shipping-only / manual money movement.
  // Line-item refunds are owned by the Returns module (upsertDraftReturnFromRefund).
  for (const r of order.refunds || []) {
    const hasLineItems = Array.isArray(r.refund_line_items) && r.refund_line_items.length > 0;
    if (hasLineItems) continue;

    // Amount from order_adjustments (shipping refunds, manual) or transactions.
    let amount = 0;
    if (Array.isArray(r.order_adjustments) && r.order_adjustments.length) {
      amount = r.order_adjustments.reduce((acc, a) => acc + Math.abs(num(a?.amount)), 0);
    } else if (Array.isArray(r.transactions) && r.transactions.length) {
      amount = r.transactions
        .filter((t) => t?.kind === 'refund')
        .reduce((acc, t) => acc + Math.abs(num(t?.amount)), 0);
    }
    if (amount <= 0) continue;

    drafts.push({
      category: 'refund',
      label: r.note ? `Refund: ${r.note}` : 'Refund (non-item)',
      amount,
      sign: -1,
      tax_amount: 0,
      source: 'shopify',
      external_ref: r.id != null ? String(r.id) : null,
      matched_rule_id: null,
      raw_payload: r,
    });
  }

  return drafts;
}
