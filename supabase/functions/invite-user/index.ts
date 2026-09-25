import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── invite-user ──────────────────────────────────────────────────────────────
// Admin → Invitations. Sends Supabase's invite email and records the role to give on acceptance.
// Only people with users.edit (at any site) may call it.
// POST { email, full_name?, username?, role_id, site_id? }          → invite a new person
// POST { email, resend: true }                                       → invite again (someone who never signed in):
//   Supabase will not re-invite an email that already has a login, so a sign-in link is emailed instead.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reply = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const redirectTo = Deno.env.get('INVITE_REDIRECT_TO') || undefined;
    const adminClient = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return reply({ error: 'Missing authorization header' }, 401);
    const { data: { user: caller }, error: authError } = await adminClient.auth.getUser(authHeader.replace('Bearer ', ''));
    if (authError || !caller) return reply({ error: 'Unauthorized' }, 401);

    // Permission: users.edit at any site, checked as the caller.
    const asCaller = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } });
    const { data: sites } = await adminClient.from('sites').select('id');
    let allowed = false;
    for (const s of sites || []) {
      const { data } = await asCaller.rpc('_has_permission', { p_code: 'users.edit', p_site_id: s.id });
      if (data === true) { allowed = true; break; }
    }
    if (!allowed) return reply({ error: 'You do not have permission to invite users' }, 403);

    const body = await req.json();
    const email = String(body.email || '').trim().toLowerCase();
    const { full_name, username, role_id, site_id, resend } = body;
    if (!email || !email.includes('@')) return reply({ error: 'email is required' }, 400);

    const { data: existingUsers } = await adminClient.auth.admin.listUsers({ perPage: 1000 });
    const existingUser = existingUsers?.users?.find((u: any) => u.email?.toLowerCase() === email);

    if (existingUser) {
      if (!resend) return reply({ error: 'A user with this email already exists' }, 409);
      if (existingUser.last_sign_in_at) return reply({ error: `${email} has already accepted and signed in` }, 409);
      // Re-invite: try Supabase's invite first (works while the invite is unconfirmed on some setups),
      // otherwise email a one-time sign-in link.
      const again = await adminClient.auth.admin.inviteUserByEmail(email, { redirectTo });
      if (again.error) {
        const pub = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
        const { error: otpErr } = await pub.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: redirectTo } });
        if (otpErr) return reply({ error: otpErr.message }, 500);
      }
      await adminClient.auth.admin.updateUserById(existingUser.id, { app_metadata: { ...(existingUser.app_metadata || {}), last_invite_resent_at: new Date().toISOString() } });
      return reply({ success: true, user_id: existingUser.id, message: `Invitation sent again to ${email}` });
    }

    if (!role_id) return reply({ error: 'email and role_id are required' }, 400);

    const { data: existingInvite } = await adminClient.from('pending_role_assignments').select('id')
      .eq('email', email).eq('is_archived', false).maybeSingle();
    if (existingInvite) return reply({ error: 'A pending invitation already exists for this email' }, 409);

    // Record the role first so the auth.users trigger (apply_pending_role_assignment) can assign it.
    const { error: pendingError } = await adminClient.from('pending_role_assignments').insert({
      email, full_name: full_name || null, username: username || null, role_id, site_id: site_id || null,
      status: 'invited', invited_at: new Date().toISOString(),
    });
    if (pendingError) console.error('Failed to record pending assignment:', pendingError);

    const { data: inviteData, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, {
      redirectTo, data: { full_name: full_name || null, username: username || null },
    });
    if (inviteError) return reply({ error: inviteError.message }, 500);

    const newUserId = inviteData.user.id;
    await adminClient.from('profiles').upsert({ id: newUserId, full_name: full_name || null, username: username || null }, { onConflict: 'id' });
    // Make sure the role is there even if the trigger already consumed the pending row.
    const { data: hasRole } = await adminClient.from('user_roles').select('id').eq('user_id', newUserId).eq('role_id', role_id).limit(1);
    if (!hasRole?.length) await adminClient.from('user_roles').insert({ user_id: newUserId, role_id, site_id: site_id || null, is_active: true });

    return reply({ success: true, user_id: newUserId, message: `Invitation email sent to ${email}` });
  } catch (err) {
    return reply({ error: (err as Error).message }, 500);
  }
});
