// ── invite-user ──────────────────────────────────────────────────────────────
// Small admin helper: sends a Supabase invite email using the service role
// key. The user receives Supabase's own magic-link invitation — they click
// it, choose their own password, and land on the app.
//
// The RBAC side is handled entirely by migration 0034: a matching row in
// pending_role_assignments causes the auth.users insert trigger to create
// the profile + user_roles rows automatically. No password is set here.
//
// Invocation:
//   curl -X POST \
//     -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
//     -H "Content-Type: application/json" \
//     -d '{"email":"clement@bravura.com","full_name":"Clement Mpala"}' \
//     https://<project>.supabase.co/functions/v1/invite-user

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const REDIRECT_TO          = Deno.env.get('INVITE_REDIRECT_TO') || 'https://bravura-campsite.vercel.app'

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Use POST', { status: 405 })
  }

  let body: { email?: string; full_name?: string } = {}
  try { body = await req.json() } catch { /* ignore */ }
  const email     = (body.email || '').trim().toLowerCase()
  const full_name = (body.full_name || '').trim()

  if (!email || !email.includes('@')) {
    return new Response(JSON.stringify({ error: 'email is required' }), {
      status: 400, headers: { 'content-type': 'application/json' },
    })
  }

  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: REDIRECT_TO,
    data: full_name ? { full_name } : undefined,
  })

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400, headers: { 'content-type': 'application/json' },
    })
  }

  return new Response(JSON.stringify({ ok: true, user_id: data.user?.id }), {
    status: 200, headers: { 'content-type': 'application/json' },
  })
})
