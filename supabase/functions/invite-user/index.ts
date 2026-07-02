// invite-user
// Admin-only. Sends a Supabase invite email to a new team member and writes
// their public.users row with the EXACT role + permission overrides chosen on
// the Settings → Users invite screen (src/components/settings/SettingsUsersTab.jsx),
// so the restriction is set the moment they accept. The frontend calls this as
// base44.functions.invoke('inviteUser', {...}) — mapped to this kebab slug in
// src/api/supabaseClient.js → EDGE_FUNCTIONS.
//
// RLS is disabled project-wide, so the admin check MUST happen here, server-side,
// using the caller's own JWT — the browser must never be trusted for this.
//
// Always returns HTTP 200 with a JSON body ({ success, error? }); a non-200
// would surface to the frontend as a raw "HTTP nnn" string.
import { getSupabase, corsHeaders, json } from '../_shared/shopify.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() });

  const supabase = getSupabase();

  // ── 1. Authenticate the caller and confirm they are an admin ──
  const authHeader = req.headers.get('Authorization') ?? '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!jwt) return json({ success: false, error: 'Not authenticated' });

  const { data: { user: caller }, error: callerErr } = await supabase.auth.getUser(jwt);
  if (callerErr || !caller?.email) {
    return json({ success: false, error: 'Could not verify your session — please sign in again' });
  }

  const { data: callerRow } = await supabase
    .from('users')
    .select('role')
    .eq('email', caller.email.toLowerCase())
    .maybeSingle();

  if (!callerRow || callerRow.role !== 'admin') {
    return json({ success: false, error: 'Only admins can invite users' });
  }

  // ── 2. Read and validate the invite payload ──
  let body: {
    email?: string; role?: string; permissions?: string;
    full_name?: string; redirect_to?: string;
  } = {};
  try { body = await req.json(); } catch { /* handled below */ }

  const email = (body.email ?? '').toString().trim().toLowerCase();
  const role = (body.role ?? 'viewer').toString().trim();
  const permissions = (body.permissions ?? '').toString();
  const fullName = (body.full_name ?? '').toString().trim();
  if (!email || !email.includes('@')) {
    return json({ success: false, error: 'A valid email address is required' });
  }

  const appUrl = (body.redirect_to || Deno.env.get('APP_URL') || '').replace(/\/+$/, '');
  const redirectTo = appUrl ? `${appUrl}/accept-invite` : undefined;

  // ── 3. Upsert the users row FIRST so the role + permissions are in place the
  //       instant the invitee accepts (AuthContext looks the row up by email). ──
  const { error: rowErr } = await supabase
    .from('users')
    .upsert(
      {
        email,
        role,
        permissions,
        ...(fullName ? { full_name: fullName } : {}),
        updated_date: new Date().toISOString(),
      },
      { onConflict: 'email' },
    );
  if (rowErr) {
    return json({ success: false, error: `Could not save the user record: ${rowErr.message}` });
  }

  // ── 4. Send the Supabase invite email (creates the auth user if new) ──
  const { error: inviteErr } = await supabase.auth.admin.inviteUserByEmail(
    email,
    redirectTo ? { redirectTo } : undefined,
  );

  if (inviteErr) {
    // Most common: the auth user already exists. The role/permissions row is
    // already saved above, so report success and point them at "Forgot password".
    if (/already|registered|exists/i.test(inviteErr.message)) {
      return json({
        success: true,
        already_member: true,
        message: `${email} already has a login — their role & permissions were updated. If they can't sign in, they can use "Forgot password".`,
      });
    }
    return json({ success: false, error: `Invite email failed: ${inviteErr.message}` });
  }

  return json({ success: true, email });
});
