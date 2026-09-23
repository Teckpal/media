/**
 * Exercises the rules from Section 6 and 7A against a real Postgres.
 *
 * The unit tests in `src/**` cover the pure functions; these cover the half of
 * the product that lives in constraints and triggers, where a rule is only real
 * if the database refuses the statement. Every `rejects` below is a loophole
 * from the project note that the schema is supposed to close.
 *
 * Run after `npm run db:local:migrate`, which leaves a clean schema.
 */
import pg from 'pg'
import { CONNECTION } from './config.mjs'

const client = new pg.Client(CONNECTION)
await client.connect()

let passed = 0
let failed = 0

const ok = (label, note = '') => {
  passed++
  console.log(`  ok    ${label}${note ? `  — ${note}` : ''}`)
}
const bad = (label, detail) => {
  failed++
  console.log(`  FAIL  ${label}\n          ${detail}`)
}

/** The database must refuse this. A success means the rule is not enforced. */
async function rejects(label, sql, params = []) {
  try {
    await client.query(sql, params)
    bad(label, 'the database ACCEPTED it — this rule is not enforced')
  } catch (error) {
    ok(label, error.message.split('\n')[0].slice(0, 88))
  }
}

async function accepts(label, sql, params = []) {
  try {
    const result = await client.query(sql, params)
    ok(label)
    return result
  } catch (error) {
    bad(label, error.message.split('\n')[0])
    return null
  }
}

const one = async (sql, params = []) => (await client.query(sql, params)).rows[0]

// --- seed --------------------------------------------------------------------
console.log('\n--- seed ---')

// Inserting into auth.users is what Supabase Auth does on signup; public.users
// is meant to appear by trigger.
const owner = await one(
  `insert into auth.users (email, raw_user_meta_data)
   values ('owner@motif.test', '{"full_name":"Demo Owner"}'::jsonb) returning id`)
const editor = await one(
  `insert into auth.users (email, raw_user_meta_data)
   values ('editor@motif.test', '{"full_name":"Demo Editor"}'::jsonb) returning id`)

const mirrored = (await client.query('select email from public.users order by email')).rows
if (mirrored.length === 2) ok('handle_new_auth_user mirrors auth.users into public.users', mirrored.map((r) => r.email).join(', '))
else bad('handle_new_auth_user', `expected 2 rows in public.users, found ${mirrored.length}`)

const ws = await one(
  `insert into public.workspaces (name, type, owner_id, timezone)
   values ('Demo Brand', 'business', $1, 'Asia/Dhaka') returning id`, [owner.id])
ok('workspace created', 'Asia/Dhaka')

await client.query(
  `insert into public.workspace_members (workspace_id, user_id, role)
   values ($1, $2, 'owner'), ($1, $3, 'editor')`, [ws.id, owner.id, editor.id])
ok('members added', 'one owner, one editor')

const account = await one(
  `insert into public.social_accounts
     (workspace_id, platform, external_account_id, external_username, status, paid_seat)
   values ($1, 'facebook', 'fb_page_1001', 'Demo Page', 'active', true) returning id`, [ws.id])
ok('facebook account connected', 'fb_page_1001')

// --- Section 6.1: connections -------------------------------------------------
console.log('\n--- Section 6.1: connections ---')

const rival = await one(
  `insert into public.workspaces (name, type, owner_id)
   values ('Rival Agency', 'business', $1) returning id`, [editor.id])

await rejects('the same social account cannot live in two workspaces',
  `insert into public.social_accounts (workspace_id, platform, external_account_id)
   values ($1, 'facebook', 'fb_page_1001')`, [rival.id])

// --- Section 6.2: posts and calendar ------------------------------------------
console.log('\n--- Section 6.2: posts and calendar ---')

const post = await one(
  `insert into public.posts (workspace_id, caption, status, created_by)
   values ($1, 'First scheduled post', 'draft', $2) returning id`, [ws.id, owner.id])
ok('draft post created')

await rejects('a post cannot be scheduled in the past',
  `update public.posts set status = 'scheduled', scheduled_at = now() - interval '2 hours' where id = $1`, [post.id])

await accepts('a post can be scheduled in the future',
  `update public.posts set status = 'scheduled', scheduled_at = now() + interval '2 hours' where id = $1`, [post.id])

const key = `post-${post.id}-facebook`
await accepts('a target is created with an idempotency key',
  `insert into public.post_targets (post_id, social_account_id, platform, idempotency_key)
   values ($1, $2, 'facebook', $3)`, [post.id, account.id, key])

await rejects('a duplicate idempotency key is refused (no double publish)',
  `insert into public.post_targets (post_id, social_account_id, platform, idempotency_key)
   values ($1, $2, 'facebook', $3)`, [post.id, account.id, key])

await accepts('scheduled -> paused (halting)',
  `update public.posts set status = 'paused' where id = $1`, [post.id])

await client.query(`update public.posts set status = 'scheduled' where id = $1`, [post.id])
await client.query(`update public.posts set status = 'publishing' where id = $1`, [post.id])

await rejects('a post cannot be edited while it is publishing',
  `update public.posts set caption = 'sneaky edit' where id = $1`, [post.id])

// --- Section 6.3: team and roles ----------------------------------------------
console.log('\n--- Section 6.3: team and roles ---')

await rejects('the last owner cannot leave the workspace',
  `delete from public.workspace_members where workspace_id = $1 and role = 'owner'`, [ws.id])

// --- Section 7A.2: the billing region lock ------------------------------------
console.log('\n--- Section 7A.2: billing region ---')

await accepts('billing_region is set at the first payment',
  `update public.workspaces set billing_region = 'bd', billing_region_locked_at = now() where id = $1`, [ws.id])

await rejects('billing_region cannot change once locked (no price hopping)',
  `update public.workspaces set billing_region = 'global' where id = $1`, [ws.id])

// --- functions ----------------------------------------------------------------
console.log('\n--- functions ---')

ok('ai_credit_balance() runs', `balance = ${(await one('select public.ai_credit_balance($1) as b', [ws.id])).b}`)

await client.query(
  `insert into public.ai_credit_ledger (workspace_id, kind, amount, source)
   values ($1, 'grant', 200, 'plan:starter')`, [ws.id])

const balance = (await one('select public.ai_credit_balance($1) as b', [ws.id])).b
if (String(balance) === '200') ok('ai_credit_balance() reflects a grant', 'balance = 200')
else bad('ai_credit_balance() after a grant', `expected 200, got ${balance}`)

const coverage = await client.query('select * from public.publishing_coverage($1)', [ws.id])
ok('publishing_coverage() runs (the publish gate)',
  coverage.rows.length ? JSON.stringify(coverage.rows[0]) : 'no active subscription -> publishing denied')

const claimed = await client.query('select * from public.claim_due_targets($1, $2, $3)', [10, 60, 3])
ok('claim_due_targets() runs', `${claimed.rows.length} due — the skip-locked claim works`)

ok('unread_notification_count() runs', `n = ${(await one('select public.unread_notification_count($1) as n', [ws.id])).n}`)

await client.query('select public.reap_stuck_targets(3)')
ok('reap_stuck_targets() runs')
await client.query('select public.expire_lapsed_ai_grants()')
ok('expire_lapsed_ai_grants() runs')
await client.query('select public.purge_expired_oauth_sessions()')
ok('purge_expired_oauth_sessions() runs')

// --- notification fan-out ------------------------------------------------------
console.log('\n--- notification fan-out ---')

const notification = await one(
  `insert into public.notifications (workspace_id, kind, title, body)
   values ($1, 'publish_failed', 'A post failed to publish', 'The platform rejected the media.')
   returning id`, [ws.id])

const deliveries = (await client.query(
  'select channel, state, skip_reason from public.notification_deliveries where notification_id = $1',
  [notification.id])).rows

if (deliveries.length) {
  ok('the after-insert trigger fans a notification out',
    deliveries.map((d) => `${d.channel}:${d.state}${d.skip_reason ? ` (${d.skip_reason})` : ''}`).join(', '))
} else {
  bad('notification fan-out', 'no notification_deliveries rows were created')
}

// --- what a new member may read -----------------------------------------------
console.log('\n--- notifications and the join date ---')

/**
 * An invitation grants a role from the day it is accepted. It is not a key to
 * the archive — so a member sees the workspace's notifications from their
 * `joined_at` onwards, and the ones addressed to them personally whenever they
 * were written.
 *
 * Checked through RLS as each user, because the rule lives in a policy and a
 * policy is only real if the database applies it.
 */
async function asMember(uid, sql, params = []) {
  await client.query('begin')
  await client.query(`select set_config('request.jwt.claims', $1, true)`, [
    JSON.stringify({ sub: uid, role: 'authenticated' }),
  ])
  await client.query('set local role authenticated')
  const { rows } = await client.query(sql, params)
  await client.query('rollback')
  return rows
}

// The owner was here first; the editor joined an hour ago. Both dates are set
// explicitly — the seed gives every membership `now()`, so without this the
// owner would also postdate the backdated notification below and the test
// would be asserting something that is not the rule.
await client.query(
  `update public.workspace_members
      set joined_at = case when user_id = $2 then now() - interval '3 days'
                                             else now() - interval '1 hour' end
    where workspace_id = $1`,
  [ws.id, owner.id],
)

await client.query(
  `insert into public.notifications (workspace_id, user_id, kind, title, created_at) values
     ($1, null, 'post_published', 'before-she-joined', now() - interval '2 hours'),
     ($1, null, 'post_published', 'after-she-joined',  now()),
     ($1, $2,   'post_failed',    'addressed-to-her',  now() - interval '3 hours')`,
  [ws.id, editor.id],
)

const seen = (
  await asMember(editor.id, 'select title from public.notifications where workspace_id = $1', [
    ws.id,
  ])
).map((r) => r.title)

if (seen.includes('before-she-joined')) {
  bad(
    'a member cannot read notifications from before they joined',
    'the workspace history was visible to somebody who was not there for it',
  )
} else {
  ok('a member cannot read notifications from before they joined')
}

if (seen.includes('after-she-joined')) ok('a member reads what happened after they joined')
else bad('a member reads what happened after they joined', 'the notification was hidden')

if (seen.includes('addressed-to-her')) {
  ok('a notification addressed to a member is theirs whenever it was written')
} else {
  bad(
    'a notification addressed to a member is theirs whenever it was written',
    'a personally addressed notification was hidden by the join date',
  )
}

const ownerSees = (
  await asMember(owner.id, 'select title from public.notifications where workspace_id = $1', [
    ws.id,
  ])
).map((r) => r.title)

if (ownerSees.includes('before-she-joined')) ok('the earlier member still reads the whole history')
else bad('the earlier member still reads the whole history', 'the owner lost rows they should see')

// The bell has its own definition of the same question, so it is checked too:
// a count including rows the list cannot show would put a number on the bell
// that leads to an empty panel.
const bell = (await asMember(editor.id, 'select public.unread_notification_count($1) as n', [ws.id]))[0].n

if (bell === seen.length) ok('the bell counts exactly what the panel can show', `n = ${bell}`)
else bad('the bell counts exactly what the panel can show', `bell says ${bell}, panel has ${seen.length}`)

console.log(`\n${passed} passed, ${failed} failed`)
await client.end()
process.exit(failed ? 1 : 0)
