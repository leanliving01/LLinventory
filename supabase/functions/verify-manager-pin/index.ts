// verify-manager-pin
// Server-side verification of a manager's 4-digit approval PIN. Used by the
// production run-completion flow (src/components/production/ManagerPinModal.jsx),
// which invokes this as 'verifyManagerPin' (mapped to this kebab-case slug in
// src/api/supabaseClient.js → EDGE_FUNCTIONS).
//
// The comparison runs here, with the service-role client, so the manager PIN
// list never ships to the browser. Always returns HTTP 200 with a JSON body —
// the frontend reads { success } / { error }, and a non-200 would be surfaced
// as a raw "HTTP nnn" string instead.
import { getSupabase, corsHeaders, json } from '../_shared/shopify.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() });

  let body: { member_id?: string; pin?: string } = {};
  try { body = await req.json(); } catch { /* empty body → handled below */ }

  const memberId = (body.member_id ?? '').toString().trim();
  const pin = (body.pin ?? '').toString().trim();

  if (!memberId || !pin) {
    return json({ success: false, error: 'Manager and PIN are required' });
  }

  const supabase = getSupabase();

  const { data: member, error } = await supabase
    .from('team_members')
    .select('id, name, manager_pin, is_manager, is_active')
    .eq('id', memberId)
    .maybeSingle();

  if (error) {
    console.error('[verify-manager-pin] lookup error:', error.message);
    return json({ success: false, error: 'Could not verify PIN — try again' });
  }
  if (!member) {
    return json({ success: false, error: 'Manager not found' });
  }
  if (!member.is_manager || !member.is_active) {
    return json({ success: false, error: 'This person is not an active manager' });
  }
  if (!member.manager_pin) {
    return json({ success: false, error: 'No PIN set for this manager — set one in Settings → Team Members' });
  }

  if (String(member.manager_pin).trim() !== pin) {
    return json({ success: false, error: 'Incorrect PIN' });
  }

  return json({ success: true, manager_name: member.name, member_id: member.id });
});
