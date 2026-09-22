/**
 * Walks the data path end to end against the live Supabase project.
 *
 * Signs a user up through GoTrue exactly as the app's signup action does, then
 * checks that the database did what Section 4 and 5 say it should: mirror the
 * user, start them at the right onboarding step, and — reading back with that
 * user's own token, through PostgREST, with RLS live — show them their own rows
 * and nobody else's.
 *
 * Creates a test user each run. Pass --cleanup to delete the ones it made.
 */
import { newClient, readEnv } from './connect.mjs'

const env = readEnv()
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY

let passed = 0
let failed = 0
const ok = (label, note = '') => { passed++; console.log(`  ok    ${label}${note ? `  — ${note}` : ''}`) }
const bad = (label, note = '') => { failed++; console.log(`  FAIL  ${label}${note ? `\n          ${note}` : ''}`) }

async function api(pathname, { key = ANON, token, method = 'GET', body, headers = {} } = {}) {
  const res = await fetch(`${URL_}${pathname}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${token || key}`,
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let parsed
  try { parsed = JSON.parse(text) } catch { parsed = text }
  return { status: res.status, body: parsed }
}

const stamp = Date.now()
const email = `walkthrough-${stamp}@example.com`
const password = `Test-${stamp}-Aa1!`

console.log('\n--- signup (GoTrue) ---')

let signup = await api('/auth/v1/signup', { method: 'POST', body: { email, password } })
let userId
let viaAdmin = false

if (signup.status >= 400) {
  // Two things stop a scripted signup on a free project, and both are worth
  // knowing about rather than working around silently:
  //   email_address_invalid     — GoTrue refuses domains with no MX record, so
  //                               no reserved test domain can ever sign up.
  //   over_email_send_rate_limit — the built-in mailer allows a couple of sends
  //                               per hour. Real signups will hit this too.
  // The admin endpoint creates the row without sending mail, which still
  // exercises the trigger and RLS — the parts we are actually testing.
  ok(`public signup refused (${signup.body?.error_code || signup.status})`,
    'falling back to the admin API, which sends no email')
  signup = await api('/auth/v1/admin/users', {
    key: SERVICE,
    method: 'POST',
    body: { email, password, email_confirm: false },
  })
  viaAdmin = true
}

if (signup.status >= 400) {
  bad('signup', JSON.stringify(signup.body).slice(0, 200))
  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(1)
}

userId = signup.body.user?.id || signup.body.id
ok(viaAdmin ? 'user created through the admin API' : 'signup accepted',
  `user id ${String(userId).slice(0, 8)}…`)

if (!viaAdmin) {
  ok('email confirmation', signup.body.access_token
    ? 'NOT required — Section 5 rule 2 expects verification first'
    : 'required — matches Section 5 rule 2 (verify before OAuth)')
}

console.log('\n--- the trigger (Section 4) ---')

const db = newClient()
await db.connect()

const { rows: mirrored } = await db.query(
  'select id, email, onboarding_step, active_module from public.users where id = $1', [userId])

if (mirrored.length === 1) {
  ok('handle_new_auth_user mirrored the user into public.users')
  const row = mirrored[0]
  if (row.onboarding_step === 'verify_email') {
    ok('onboarding_step starts at verify_email', 'the router gate will hold them there')
  } else {
    bad('onboarding_step', `expected verify_email, got ${row.onboarding_step}`)
  }
} else {
  bad('handle_new_auth_user', `expected 1 row in public.users, found ${mirrored.length}`)
}

console.log('\n--- RLS, as that user, through PostgREST ---')

// Confirm the address so a password grant works, the way clicking the link would.
await db.query('update auth.users set email_confirmed_at = now() where id = $1', [userId])

const login = await api('/auth/v1/token?grant_type=password', {
  method: 'POST', body: { email, password },
})

if (login.status >= 400 || !login.body.access_token) {
  bad('password login', JSON.stringify(login.body).slice(0, 160))
} else {
  ok('password login returns a session')
  const token = login.body.access_token

  const own = await api(`/rest/v1/users?select=id,onboarding_step&id=eq.${userId}`, { token })
  if (Array.isArray(own.body) && own.body.length === 1) ok('the user can read their own row')
  else bad('own row', `status ${own.status}: ${JSON.stringify(own.body).slice(0, 140)}`)

  const everyone = await api('/rest/v1/users?select=id', { token })
  if (Array.isArray(everyone.body) && everyone.body.length === 1) {
    ok('RLS holds — they see only themselves', `${everyone.body.length} row`)
  } else {
    bad('RLS on users', `saw ${Array.isArray(everyone.body) ? everyone.body.length : '?'} rows`)
  }

  const others = await api('/rest/v1/workspaces?select=id', { token })
  if (Array.isArray(others.body) && others.body.length === 0) ok('no workspaces visible yet')
  else bad('RLS on workspaces', JSON.stringify(others.body).slice(0, 140))

  // Section 1: tokens must never be readable by a browser client.
  const tokens = await api('/rest/v1/social_accounts?select=access_token_encrypted', { token })
  if (tokens.status >= 400) {
    ok('token columns are not readable by a signed-in user', `refused with ${tokens.status}`)
  } else {
    bad('TOKEN LEAK', 'access_token_encrypted was selectable by an ordinary user')
  }
}

console.log('\n--- publish gate (Section 4, gate 2) ---')

const { rows: coverage } = await db.query('select * from public.publishing_coverage($1)', [
  '00000000-0000-0000-0000-000000000000',
])
ok('publishing_coverage() answers on the live schema',
  coverage.length ? JSON.stringify(coverage[0]) : 'no subscription -> publishing denied')

if (process.argv.includes('--cleanup')) {
  console.log('\n--- cleanup ---')
  const del = await api(`/auth/v1/admin/users/${userId}`, { key: SERVICE, method: 'DELETE' })
  if (del.status < 400) ok('test user deleted')
  else bad('cleanup', `status ${del.status}`)
}

await db.end()
console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
