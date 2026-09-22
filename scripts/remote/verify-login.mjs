/** Proves the seeded account can sign in and would clear the router gate. */
import { newClient, readEnv } from './connect.mjs'

const env = readEnv()
const email = process.argv[2]
const password = process.argv[3]

const res = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: {
    apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ email, password }),
})
const body = await res.json()

if (!body.access_token) {
  console.log('LOGIN FAILED:', JSON.stringify(body).slice(0, 200))
  process.exit(1)
}
console.log('  login ok, session issued')
console.log('  email confirmed:', Boolean(body.user?.email_confirmed_at))

const db = newClient()
await db.connect()
const { rows } = await db.query(
  `select u.onboarding_step, u.active_workspace_id, u.active_module,
          (select count(*)::int from public.workspace_members m
             where m.user_id = u.id and m.workspace_id = u.active_workspace_id) as membership,
          (select count(*)::int from public.social_accounts s
             where s.workspace_id = u.active_workspace_id and s.status = 'active') as active_connections
     from public.users u where u.id = $1`,
  [body.user.id],
)
const g = rows[0]
await db.end()

const checks = [
  ['email verified', Boolean(body.user?.email_confirmed_at)],
  ['onboarding done', g.onboarding_step === 'done'],
  ['active workspace pinned', Boolean(g.active_workspace_id)],
  ['is a member of it', g.membership === 1],
  ['has an active connection', g.active_connections > 0],
]

console.log('\n  router gate:')
for (const [label, pass] of checks) console.log(`    ${pass ? 'ok  ' : 'FAIL'} ${label}`)
console.log(`\n  ${checks.every(([, p]) => p) ? 'reaches the dashboard' : 'would be bounced'}`)
