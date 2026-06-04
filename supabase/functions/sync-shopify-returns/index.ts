// Imports Shopify native Returns (RMAs) as Draft Returns. REST does not expose
// returns, so this uses the GraphQL Admin API. No-op for stores without the
// Returns feature (query simply yields nothing). Refunds are imported separately
// by sync-shopify-orders; this complements that for native returns.
import { shopifyBaseUrl, SHOPIFY_TOKEN, getSupabase, corsHeaders, json } from '../_shared/shopify.ts';
import { upsertDraftReturnFromReturn, gidToId } from '../_shared/returns.ts';

const RETURNS_QUERY = `
query Returns($cursor: String) {
  orders(first: 25, after: $cursor, query: "return_status:in_progress OR return_status:returned OR return_status:return_requested OR return_status:inspection_complete") {
    pageInfo { hasNextPage endCursor }
    edges {
      node {
        legacyResourceId
        returns(first: 20) {
          edges {
            node {
              id
              name
              status
              returnLineItems(first: 50) {
                edges {
                  node {
                    ... on ReturnLineItem {
                      id
                      quantity
                      returnReason
                      returnReasonNote
                      fulfillmentLineItem { lineItem { id sku title variantTitle } }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}`;

// deno-lint-ignore no-explicit-any
async function graphql(query: string, variables: Record<string, unknown>): Promise<any> {
  const res = await fetch(`${shopifyBaseUrl()}/graphql.json`, {
    method: 'POST',
    headers: {
      'X-Shopify-Access-Token': SHOPIFY_TOKEN,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GraphQL ${res.status}: ${text.slice(0, 200)}`);
  }
  return await res.json();
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() });

  let body: { maxPages?: number } = {};
  try { body = await req.json(); } catch { /* empty ok */ }
  const maxPages = Math.min(body.maxPages ?? 5, 20);

  const supabase = getSupabase();
  let cursor: string | null = null;
  let pages = 0;
  let imported = 0;
  let returnsSeen = 0;

  try {
    while (pages < maxPages) {
      const result = await graphql(RETURNS_QUERY, { cursor });
      if (result.errors) {
        return json({ status: 'error', error: JSON.stringify(result.errors).slice(0, 300), imported, returns_seen: returnsSeen });
      }
      const orders = result?.data?.orders;
      if (!orders) break;

      for (const orderEdge of orders.edges || []) {
        const shopifyOrderId = String(orderEdge.node.legacyResourceId);
        for (const retEdge of orderEdge.node.returns?.edges || []) {
          const rn = retEdge.node;
          returnsSeen++;
          const lines = (rn.returnLineItems?.edges || []).map((e: { node: Record<string, unknown> }) => {
            const node = e.node as Record<string, unknown>;
            const fli = node.fulfillmentLineItem as { lineItem?: { id?: string; sku?: string; title?: string; variantTitle?: string } } | undefined;
            return {
              shopify_line_item_id: fli?.lineItem?.id ? gidToId(fli.lineItem.id) : null,
              quantity: Number(node.quantity) || 0,
              value: null,
              reason: (node.returnReason as string) || (node.returnReasonNote as string) || null,
              sku: fli?.lineItem?.sku ?? null,
              title: fli?.lineItem?.title ?? null,
              variant_title: fli?.lineItem?.variantTitle ?? null,
            };
          });
          const res = await upsertDraftReturnFromReturn(supabase, {
            shopify_return_id: gidToId(rn.id),
            shopify_order_id: shopifyOrderId,
            name: rn.name ?? null,
            status: rn.status ?? null,
            reason: null,
            created_at: null,
            lines,
          });
          if (res.status === 'created') imported++;
        }
      }

      pages++;
      if (!orders.pageInfo?.hasNextPage) break;
      cursor = orders.pageInfo.endCursor;
    }
  } catch (e) {
    return json({ status: 'error', error: (e as Error).message, imported, returns_seen: returnsSeen });
  }

  return json({ status: 'completed', pages, returns_seen: returnsSeen, imported });
});
