/**
 * Tells you exactly what is and is not working about the Supabase project in
 * `.env.local`, in one command.
 *
 * Written because the failure that cost the most time here was a silent one:
 * the keys in `.env.local` named a live project but were rejected by it, and
 * every symptom — blank pages, empty cron results, "nothing due" — looked like
 * something else. This asks the project directly and says which part is wrong.
 *
 *   npm run check:supabase
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const env = {}
for (const line of fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].replace(/^"(.*)"$/, '$1')
}

const URL_ = env.NEXT_PUBLIC_SUPABASE_URL
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY

let problems = 0
const ok = (label, note = '') => console.log(`  ok    ${label}${note ? `  — ${note}` : ''}`)
const no = (label, note = '') => {
  problems++
  console.log(`  X     ${label}${note ? `  — ${note}` : ''}`)
}

async function call(pathname, key, init = {}) {
  const res = await fetch(`${URL_}${pathname}`, {
    ...init,
    headers: { apikey: key, Authorization: `Bearer ${key}`, ...(init.headers || {}) },
  })
  const text = await res.text()
  let body
  try {
    body = JSON.parse(text)
  } catch {
    body = text
  }
  return { status: res.status, body }
}

console.log('\n--- configuration ---')

if (!URL_) no('NEXT_PUBLIC_SUPABASE_URL is not set')
else ok('project URL', URL_)

if (!ANON) no('NEXT_PUBLIC_SUPABASE_ANON_KEY is not set')
else ok('anon key present', `${ANON.slice(0, 12)}… (${ANON.length} chars)`)

if (!SERVICE) no('SUPABASE_SERVICE_ROLE_KEY is not set')
else ok('service role key present', `${SERVICE.slice(0, 12)}… (${SERVICE.length} chars)`)

if (!URL_ || !ANON || !SERVICE) {
  console.log('\nFill those in from the Supabase dashboard (Project Settings -> API) and run again.')
  process.exit(1)
}

console.log('\n--- the project answers ---')

const health = await call('/auth/v1/health', ANON)
if (health.status === 200) ok('auth (GoTrue) reachable with the anon key', JSON.stringify(health.body).slice(0, 70))
else no(`auth rejected the anon key (${health.status})`, JSON.stringify(health.body).slice(0, 90))

// Probe a table, not `/rest/v1/`. That root path serves the OpenAPI spec, which
// a publishable key is not allowed to read — so using it as a liveness check
// reports a perfectly good key as broken.
const rest = await call('/rest/v1/plans?select=code&limit=1', ANON)
if (rest.status < 400) ok('REST (PostgREST) reachable with the anon key')
else if (rest.status === 404 || (rest.body && rest.body.code === '42P01')) {
  ok('REST reachable with the anon key', 'schema not pushed yet, so no table to read')
} else no(`REST rejected the anon key (${rest.status})`, JSON.stringify(rest.body).slice(0, 90))

const restService = await call('/rest/v1/', SERVICE)
if (restService.status < 400) ok('REST reachable with the service role key')
else no(`REST rejected the service role key (${restService.status})`, JSON.stringify(restService.body).slice(0, 90))

if (problems) {
  console.log('\nThe keys do not match this project. Copy the current ones from')
  console.log('Project Settings -> API. Keys are rotated when a project is restored or reset.')
  process.exit(1)
}

console.log('\n--- schema ---')

const EXPECTED = [
  'users', 'workspaces', 'workspace_members', 'profiles_setup', 'invites',
  'social_accounts', 'account_transfer_requests', 'post_media', 'posts',
  'post_targets', 'approvals', 'plans', 'subscriptions', 'invoices',
  'invoice_lines', 'payments', 'gateway_events', 'billing_credits',
  'ai_credit_ledger', 'ai_plans', 'notifications', 'notification_deliveries',
  'notification_reads', 'notification_preferences', 'whatsapp_links',
  'audit_log', 'oauth_sessions',
]

const missing = []
for (const table of EXPECTED) {
  const res = await call(`/rest/v1/${table}?select=*&limit=0`, SERVICE)
  if (res.status >= 400) missing.push(table)
}

if (!missing.length) {
  ok(`all ${EXPECTED.length} tables present`)
} else if (missing.length === EXPECTED.length) {
  no('no tables found — the migrations have not been pushed')
  console.log('\n      Run:  npx supabase link --project-ref <ref>')
  console.log('            npx supabase db push')
} else {
  no(`${missing.length} table(s) missing`, missing.join(', '))
}

if (missing.length < EXPECTED.length) {
  const plans = await call('/rest/v1/plans?select=code,region,currency,price_per_seat_minor', SERVICE)
  if (Array.isArray(plans.body) && plans.body.length) {
    ok(`plans seeded (${plans.body.length})`, plans.body.map((p) => `${p.region}/${p.code}`).join(', '))
  } else {
    no('plans table is empty — migration 0009 did not seed')
  }

  // RLS is the point of the anon key: it must NOT see other people's rows.
  const leak = await call('/rest/v1/workspaces?select=id&limit=1', ANON)
  if (Array.isArray(leak.body) && leak.body.length === 0) {
    ok('RLS holds — the anon key sees no workspaces')
  } else if (leak.status === 401 || leak.status === 403) {
    ok('RLS holds — the anon key is refused outright', `${leak.status}`)
  } else {
    no('RLS LEAK — the anon key can read workspaces', JSON.stringify(leak.body).slice(0, 90))
  }
}

console.log(`\n${problems ? `${problems} problem(s)` : 'everything checks out'}\n`)
process.exit(problems ? 1 : 0)
