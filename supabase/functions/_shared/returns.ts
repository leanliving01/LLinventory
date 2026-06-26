// Shared helper: import Shopify refunds and native returns into our
// shopify_returns / shopify_return_lines as Draft Returns.
//
// Core rules:
//  - Importing NEVER moves stock. A draft is created/updated only.
//  - Idempotent per Shopify object via dedupe_key (`refund:{id}` / `return:{id}`).
//  - Cross-signal de-dupe: a native return is authoritative; if it covers the
//    same order line items as a refund-sourced draft, the refund draft is removed.
//  - User progress is protected: an already-actioned draft (status != draft_return)
//    is not overwritten on re-import.

// deno-lint-ignore no-explicit-any
type SB = any;

interface NormalizedLine {
  shopify_line_item_id: string | null;
  quantity: number;
  value?: number | null;
  reason?: string | null;
  sku?: string | null;
  title?: string | null;
  variant_title?: string | null;
  variant_id?: string | null;
}

interface NormalizedReturn {
  shopify_return_id: string;
  shopify_order_id: string;
  name?: string | null;
  status?: string | null;
  reason?: string | null;
  created_at?: string | null;
  lines: NormalizedLine[];
}

// gid://shopify/Return/12345 -> "12345"; passes through plain numeric ids.
export function gidToId(gid: string | number | null | undefined): string {
  if (gid === null || gid === undefined) return '';
  const s = String(gid);
  const idx = s.lastIndexOf('/');
  return idx >= 0 ? s.slice(idx + 1) : s;
}

async function nextReturnNumber(supabase: SB): Promise<string> {
  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const { data, error } = await supabase.rpc('next_doc_number', { p_prefix: 'RTN', p_date: dateStr });
  if (error || !data) return `RTN-${Date.now()}`;
  return data as string;
}

interface OrderContext {
  sales_order_id: string | null;
  order_number: string | null;
  customer_name: string | null;
  customer_email: string | null;
  // line item id (external_id) -> sales_order_line
  linesByItemId: Map<string, Record<string, unknown>>;
}

async function resolveOrderContext(supabase: SB, shopifyOrderId: string): Promise<OrderContext> {
  const { data: so } = await supabase
    .from('sales_orders')
    .select('id, order_number, customer_name, customer_email')
    .eq('shopify_order_id', shopifyOrderId)
    .maybeSingle();

  const linesByItemId = new Map<string, Record<string, unknown>>();
  if (so?.id) {
    const { data: lines } = await supabase
      .from('sales_order_lines')
      .select('id, external_id, shopify_variant_id, sku, name, variant_title, unit_price, our_product_id')
      .eq('sales_order_id', so.id);
    for (const l of lines || []) {
      if (l.external_id) linesByItemId.set(String(l.external_id), l);
    }
  }

  return {
    sales_order_id: so?.id ?? null,
    order_number: so?.order_number ?? null,
    customer_name: so?.customer_name ?? null,
    customer_email: so?.customer_email ?? null,
    linesByItemId,
  };
}

// Returns the set of shopify_line_item_ids already covered by existing
// shopify_returns rows of a given source for an order.
async function coveredLineItemIds(supabase: SB, shopifyOrderId: string, source: 'refund' | 'return'): Promise<Set<string>> {
  const covered = new Set<string>();
  const { data: rows } = await supabase
    .from('shopify_returns')
    .select('id')
    .eq('shopify_order_id', shopifyOrderId)
    .eq('source', source);
  const ids = (rows || []).map((r: { id: string }) => r.id);
  if (!ids.length) return covered;
  const { data: lines } = await supabase
    .from('shopify_return_lines')
    .select('shopify_line_item_id')
    .in('return_id', ids);
  for (const l of lines || []) {
    if (l.shopify_line_item_id) covered.add(String(l.shopify_line_item_id));
  }
  return covered;
}

interface UpsertHeader {
  source: 'refund' | 'return';
  dedupe_key: string;
  shopify_refund_id?: string | null;
  shopify_return_id?: string | null;
  shopify_reference?: string | null;
  shopify_order_id: string;
  return_date?: string | null;
  shopify_status?: string | null;
  shopify_reason?: string | null;
}

// Upserts a return + its lines by dedupe_key. Skips line/status churn if the
// existing draft has already been actioned by a user.
async function upsertReturn(supabase: SB, header: UpsertHeader, ctx: OrderContext, lines: NormalizedLine[]): Promise<{ status: string; return_id?: string }> {
  const now = new Date().toISOString();

  const { data: existing } = await supabase
    .from('shopify_returns')
    .select('id, status')
    .eq('dedupe_key', header.dedupe_key)
    .maybeSingle();

  const totalValue = lines.reduce((s, l) => s + (Number(l.value) || 0), 0);

  if (existing?.id) {
    // Refresh light Shopify fields always; only replace lines while still a draft.
    await supabase.from('shopify_returns').update({
      shopify_status: header.shopify_status ?? null,
      shopify_reason: header.shopify_reason ?? null,
      updated_date: now,
    }).eq('id', existing.id);

    if (existing.status === 'draft_return') {
      await supabase.from('shopify_return_lines').delete().eq('return_id', existing.id);
      await insertLines(supabase, existing.id, ctx, lines);
      await supabase.from('shopify_returns').update({ total_return_value: totalValue, updated_date: now }).eq('id', existing.id);
    }
    return { status: 'updated', return_id: existing.id };
  }

  const returnNumber = await nextReturnNumber(supabase);
  const id = crypto.randomUUID();
  await supabase.from('shopify_returns').insert({
    id,
    return_number: returnNumber,
    sales_order_id: ctx.sales_order_id,
    shopify_order_id: header.shopify_order_id,
    order_number: ctx.order_number,
    customer_name: ctx.customer_name,
    customer_email: ctx.customer_email,
    source: header.source,
    shopify_refund_id: header.shopify_refund_id ?? null,
    shopify_return_id: header.shopify_return_id ?? null,
    shopify_reference: header.shopify_reference ?? null,
    dedupe_key: header.dedupe_key,
    return_date: header.return_date ?? now,
    shopify_status: header.shopify_status ?? null,
    shopify_reason: header.shopify_reason ?? null,
    status: 'draft_return',
    stock_path: 'undecided',
    total_return_value: totalValue,
    created_date: now,
    updated_date: now,
  });
  await insertLines(supabase, id, ctx, lines);
  return { status: 'created', return_id: id };
}

async function insertLines(supabase: SB, returnId: string, ctx: OrderContext, lines: NormalizedLine[]): Promise<void> {
  if (!lines.length) return;
  const now = new Date().toISOString();
  const rows = lines.map((l) => {
    const sol = l.shopify_line_item_id ? ctx.linesByItemId.get(String(l.shopify_line_item_id)) : undefined;
    const unitPrice = sol ? Number(sol.unit_price) || 0 : 0;
    const value = (l.value !== null && l.value !== undefined)
      ? Number(l.value)
      : (Number(l.quantity) || 0) * unitPrice;
    return {
      id: crypto.randomUUID(),
      return_id: returnId,
      sales_order_line_id: sol?.id ?? null,
      shopify_line_item_id: l.shopify_line_item_id ?? null,
      shopify_variant_id: l.variant_id ?? (sol?.shopify_variant_id ?? null),
      product_id: sol?.our_product_id ?? null,
      sku: l.sku ?? (sol?.sku ?? null),
      product_name: l.title ?? (sol?.name ?? null),
      variant_title: l.variant_title ?? (sol?.variant_title ?? null),
      qty_returned: Number(l.quantity) || 0,
      return_value: value,
      reason: l.reason ?? null,
      created_date: now,
      updated_date: now,
    };
  });
  await supabase.from('shopify_return_lines').insert(rows);
}

// ---- Public entry points --------------------------------------------------

// deno-lint-ignore no-explicit-any
export async function upsertDraftReturnFromRefund(supabase: SB, refund: any, fallbackOrderId?: string | number): Promise<{ status: string; return_id?: string }> {
  const shopifyOrderId = String(refund?.order_id ?? fallbackOrderId ?? '');
  if (!shopifyOrderId) return { status: 'skipped_no_order' };

  // restock_type 'cancel' = line removed from an unfulfilled order (never shipped).
  // That is an order-line cancellation handled by the order sync (the line is netted
  // out / marked cancelled so it stops committing) — NOT a physical return. Excluding
  // it here prevents a phantom Draft Return for goods that never left the building.
  const refundLineItems: any[] = (refund?.refund_line_items || [])
    .filter((rli: any) => rli?.restock_type !== 'cancel');
  if (!refundLineItems.length) return { status: 'skipped_no_lines' }; // shipping-only or cancel-only refund

  // Cross-signal de-dupe: skip if a native return already covers these line items.
  const coveredByReturn = await coveredLineItemIds(supabase, shopifyOrderId, 'return');
  const allCovered = refundLineItems.every((rli) => coveredByReturn.has(String(rli.line_item_id)));
  if (coveredByReturn.size && allCovered) return { status: 'skipped_covered_by_return' };

  const ctx = await resolveOrderContext(supabase, shopifyOrderId);

  const lines: NormalizedLine[] = refundLineItems.map((rli) => ({
    shopify_line_item_id: rli.line_item_id != null ? String(rli.line_item_id) : null,
    quantity: Number(rli.quantity) || 0,
    value: rli.subtotal != null ? Number(rli.subtotal) : (rli.subtotal_set?.shop_money?.amount != null ? Number(rli.subtotal_set.shop_money.amount) : null),
    reason: rli.restock_type ? `restock: ${rli.restock_type}` : null,
    sku: rli.line_item?.sku ?? null,
    title: rli.line_item?.title ?? null,
    variant_title: rli.line_item?.variant_title ?? null,
    variant_id: rli.line_item?.variant_id != null ? String(rli.line_item.variant_id) : null,
  }));

  return upsertReturn(supabase, {
    source: 'refund',
    dedupe_key: `refund:${refund.id}`,
    shopify_refund_id: String(refund.id),
    shopify_reference: refund.id != null ? `Refund ${refund.id}` : null,
    shopify_order_id: shopifyOrderId,
    return_date: refund.created_at ?? null,
    shopify_status: 'refunded',
    shopify_reason: refund.note ?? null,
  }, ctx, lines);
}

export async function upsertDraftReturnFromReturn(supabase: SB, ret: NormalizedReturn): Promise<{ status: string; return_id?: string }> {
  if (!ret.shopify_order_id) return { status: 'skipped_no_order' };
  if (!ret.lines?.length) return { status: 'skipped_no_lines' };

  const ctx = await resolveOrderContext(supabase, ret.shopify_order_id);

  const result = await upsertReturn(supabase, {
    source: 'return',
    dedupe_key: `return:${ret.shopify_return_id}`,
    shopify_return_id: ret.shopify_return_id,
    shopify_reference: ret.name ?? null,
    shopify_order_id: ret.shopify_order_id,
    return_date: ret.created_at ?? null,
    shopify_status: ret.status ?? null,
    shopify_reason: ret.reason ?? null,
  }, ctx, ret.lines);

  // Native return is authoritative: drop any refund-sourced draft covering the
  // same line items (only if those drafts are still unactioned).
  const itemIds = new Set(ret.lines.map((l) => String(l.shopify_line_item_id)).filter(Boolean));
  if (itemIds.size) {
    const { data: refundRows } = await supabase
      .from('shopify_returns')
      .select('id, status')
      .eq('shopify_order_id', ret.shopify_order_id)
      .eq('source', 'refund')
      .eq('status', 'draft_return');
    for (const row of refundRows || []) {
      const { data: rl } = await supabase.from('shopify_return_lines').select('shopify_line_item_id').eq('return_id', row.id);
      const rowItemIds = (rl || []).map((x: { shopify_line_item_id: string }) => String(x.shopify_line_item_id));
      if (rowItemIds.length && rowItemIds.every((x) => itemIds.has(x))) {
        await supabase.from('shopify_return_lines').delete().eq('return_id', row.id);
        await supabase.from('shopify_returns').delete().eq('id', row.id);
      }
    }
  }

  return result;
}
