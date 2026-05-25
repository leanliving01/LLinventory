import { getSupabase, corsHeaders, json } from '../_shared/shopify.ts';

interface ReconBody {
  scope?: 'orders' | 'products' | 'all';
  auto_correct?: boolean;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() });

  let body: ReconBody = {};
  try { body = await req.json(); } catch { /* empty body ok */ }
  const scope = body.scope || 'all';
  const supabase = getSupabase();

  const now = new Date().toISOString();
  let mismatchesFound = 0;
  const mismatchRows: Record<string, unknown>[] = [];

  if (scope === 'orders' || scope === 'all') {
    // Shopify orders that have no matching sales_order
    const { data: shopOrders } = await supabase
      .from('shopify_orders').select('id, shopify_order_id, order_number')
      .limit(5000);
    const { data: salesOrders } = await supabase
      .from('sales_orders').select('id, shopify_order_id').limit(5000);
    const salesByShopId = new Set((salesOrders || []).map(s => s.shopify_order_id));

    for (const so of (shopOrders || [])) {
      if (!salesByShopId.has(so.shopify_order_id)) {
        mismatchesFound++;
        mismatchRows.push({
          id: crypto.randomUUID(),
          entity_type: 'order',
          external_id: String(so.shopify_order_id),
          field: 'sales_order_link',
          shopify_value: `Order ${so.order_number}`,
          base44_value: 'missing',
          detected_at: now,
          auto_corrected: false,
          created_date: now,
          updated_date: now,
        });
      }
    }
  }

  if (scope === 'products' || scope === 'all') {
    // Unmapped Shopify order lines
    const { data: lines } = await supabase
      .from('shopify_order_lines').select('id, product_title, is_mapped')
      .eq('is_mapped', false).limit(5000);
    for (const l of (lines || [])) {
      mismatchesFound++;
      mismatchRows.push({
        id: crypto.randomUUID(),
        entity_type: 'product',
        external_id: String(l.id),
        field: 'product_mapping',
        shopify_value: String(l.product_title || 'unknown'),
        base44_value: 'unmapped',
        detected_at: now,
        auto_corrected: false,
        created_date: now,
        updated_date: now,
      });
    }
  }

  if (mismatchRows.length) {
    for (let i = 0; i < mismatchRows.length; i += 500) {
      await supabase.from('reconciliation_mismatches').insert(mismatchRows.slice(i, i + 500));
    }
  }

  return json({
    status: 'completed',
    mismatches_found: mismatchesFound,
    mismatches_corrected: 0,
    scope,
    auto_correct: !!body.auto_correct,
  });
});
