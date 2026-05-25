import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export const SHOPIFY_API_VERSION = '2024-01';
export const SHOPIFY_DOMAIN = Deno.env.get('SHOPIFY_STORE_DOMAIN')!;
export const SHOPIFY_TOKEN = Deno.env.get('SHOPIFY_ACCESS_TOKEN')!;

export function shopifyBaseUrl(): string {
  // domain may be 'mystore.myshopify.com' or 'https://mystore.myshopify.com'
  const host = SHOPIFY_DOMAIN.replace(/^https?:\/\//, '').replace(/\/$/, '');
  return `https://${host}/admin/api/${SHOPIFY_API_VERSION}`;
}

export interface ShopifyFetchResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  nextPageInfo: string | null; // cursor for next page, null if last page
  apiCallLimit: { used: number; max: number } | null;
  retryAfter: number | null;
  errorText?: string;
}

export async function shopifyFetch<T>(
  path: string,
  params: Record<string, string> = {},
): Promise<ShopifyFetchResult<T>> {
  const qs = new URLSearchParams(params).toString();
  const url = `${shopifyBaseUrl()}${path}${qs ? `?${qs}` : ''}`;

  const res = await fetch(url, {
    headers: {
      'X-Shopify-Access-Token': SHOPIFY_TOKEN,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
  });

  const apiLimitHeader = res.headers.get('X-Shopify-Shop-Api-Call-Limit');
  let apiCallLimit: { used: number; max: number } | null = null;
  if (apiLimitHeader) {
    const [used, max] = apiLimitHeader.split('/').map(Number);
    apiCallLimit = { used, max };
  }

  const retryAfter = res.status === 429
    ? Number(res.headers.get('Retry-After') || '4')
    : null;

  const link = res.headers.get('Link') || '';
  const nextPageInfo = parseLinkHeader(link);

  if (!res.ok) {
    const errorText = await res.text();
    return { ok: false, status: res.status, data: null, nextPageInfo, apiCallLimit, retryAfter, errorText };
  }

  const data = await res.json() as T;
  return { ok: true, status: res.status, data, nextPageInfo, apiCallLimit, retryAfter };
}

// Parses Shopify Link header for the `rel="next"` page_info cursor.
// Example: <https://shop.myshopify.com/admin/api/2024-01/products.json?limit=250&page_info=eyJ...>; rel="next"
export function parseLinkHeader(linkHeader: string): string | null {
  const parts = linkHeader.split(',');
  for (const part of parts) {
    if (!part.includes('rel="next"')) continue;
    const match = part.match(/<([^>]+)>/);
    if (!match) continue;
    const url = match[1];
    const u = new URL(url);
    return u.searchParams.get('page_info');
  }
  return null;
}

export function getSupabase() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
}

export function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };
}

export function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
  });
}
