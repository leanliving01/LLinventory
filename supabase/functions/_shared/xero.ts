import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export const XERO_TOKEN_URL = 'https://identity.xero.com/connect/token';
export const XERO_API_BASE = 'https://api.xero.com/api.xro/2.0';
export const XERO_CONNECTIONS_URL = 'https://api.xero.com/connections';

export const CLIENT_ID = Deno.env.get('XERO_CLIENT_ID')!;
export const CLIENT_SECRET = Deno.env.get('XERO_CLIENT_SECRET')!;
export const REDIRECT_URI = Deno.env.get('XERO_REDIRECT_URI')!;

export function getSupabase() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
}

export interface XeroTokens {
  access_token: string;
  refresh_token: string;
  tenant_id: string;
  expires_at: number; // unix ms
}

export async function loadTokens(supabase: ReturnType<typeof getSupabase>): Promise<XeroTokens | null> {
  const { data } = await supabase
    .from('settings')
    .select('value')
    .eq('key', 'xero_tokens')
    .maybeSingle();
  if (!data?.value) return null;
  try { return JSON.parse(data.value) as XeroTokens; } catch { return null; }
}

export async function saveTokens(supabase: ReturnType<typeof getSupabase>, tokens: XeroTokens) {
  const { data: existing } = await supabase
    .from('settings')
    .select('id')
    .eq('key', 'xero_tokens')
    .maybeSingle();

  if (existing) {
    await supabase.from('settings')
      .update({ value: JSON.stringify(tokens), updated_date: new Date().toISOString() })
      .eq('key', 'xero_tokens');
  } else {
    await supabase.from('settings').insert({
      id: crypto.randomUUID(),
      key: 'xero_tokens',
      value: JSON.stringify(tokens),
      group: 'xero',
      label: 'Xero OAuth Tokens',
    });
  }
}

export async function deleteTokens(supabase: ReturnType<typeof getSupabase>) {
  await supabase.from('settings').delete().eq('key', 'xero_tokens');
}

// Refreshes access token if within 5 minutes of expiry, returns valid tokens
export async function getValidTokens(supabase: ReturnType<typeof getSupabase>): Promise<XeroTokens | null> {
  const tokens = await loadTokens(supabase);
  if (!tokens) return null;

  const fiveMinutes = 5 * 60 * 1000;
  if (Date.now() < tokens.expires_at - fiveMinutes) return tokens;

  // Refresh
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: tokens.refresh_token,
  });
  const basic = btoa(`${CLIENT_ID}:${CLIENT_SECRET}`);
  const res = await fetch(XERO_TOKEN_URL, {
    method: 'POST',
    headers: { 'Authorization': `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!res.ok) {
    await deleteTokens(supabase);
    return null;
  }

  const json = await res.json();
  const refreshed: XeroTokens = {
    access_token: json.access_token,
    refresh_token: json.refresh_token || tokens.refresh_token,
    tenant_id: tokens.tenant_id,
    expires_at: Date.now() + json.expires_in * 1000,
  };
  await saveTokens(supabase, refreshed);
  return refreshed;
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
