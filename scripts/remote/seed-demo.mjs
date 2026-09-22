/**
 * Creates one account that can actually reach the dashboard.
 *
 * The router gate (Section 4) wants four things at once: a confirmed email,
 * `onboarding_step` at `done`, a workspace the user is a member of and has
 * pinned as active, and at least one connection in `active`. Miss any one and
 * the dashboard bounces you back to the step that is missing — so a demo login
 * is not a row in `auth.users`, it is all four.
 *
 * The connection it writes is FAKE: there is no Meta app yet, so there is no
 * real token to store. It is enough to get past the gate and see the screens.
 * Anything that actually calls the platform will fail on it, which is correct.
 *
 *   node scripts/remote/seed-demo.mjs <email> [password]
 */
import { newClient, readEnv } from './connect.mjs'

const env = readEnv()
const [, , emailArg, passwordArg] = process.argv

if (!emailArg) {
  console.error('usage: node scripts/remote/seed-demo.mjs <email> [password]')
  process.exit(1)
}

const email = emailArg
const password = passwordArg || `Motif-${Math.random().toString(36).slice(2, 10)}-2026`

async function auth(path, init = {}) {
  const res = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}${path}`, {
    ...init,
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  })
  const text = await res.text()
  let body
  try { body = JSON.parse(text) } catch { body = text }
  return { status: res.status, body }
}

// --- the account ------------------------------------------------------------
// `email_confirm: true` because the built-in mailer is rate limited to a
// couple of sends an hour, and a confirmation link nobody receives is not a
// login. The gate only asks that the address IS confirmed.
let created = await auth('/auth/v1/admin/users', {
  method: 'POST',
  body: JSON.stringify({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: 'Demo Owner' },
  }),
})

let userId = created.body?.id

if (created.status >= 400) {
  const already = /already|exists|registered/i.test(JSON.stringify(created.body))
  if (!already) {
    console.error('could not create the user:', JSON.stringify(created.body).slice(0, 300))
    process.exit(1)
  }
  // Reuse it and reset the password, so running this twice is not an error.
  const list = await auth(`/auth/v1/admin/users?page=1&per_page=200`)
  const found = (list.body?.users || []).find((u) => u.email?.toLowerCase() === email.toLowerCase())
  if (!found) {
    console.error('the address is taken but the user could not be found')
    process.exit(1)
  }
  userId = found.id
  created = await auth(`/auth/v1/admin/users/${userId}`, {
    method: 'PUT',
    body: JSON.stringify({ password, email_confirm: true }),
  })
  console.log('  existing account reused, password reset')
} else {
  console.log('  account created')
}

// --- everything the gate checks --------------------------------------------
const db = newClient()
await db.connect()

try {
  await db.query('begin')

  const { rows: mirrored } = await db.query('select id from public.users where id = $1', [userId])
  if (!mirrored.length) {
    throw new Error('handle_new_auth_user did not mirror the user into public.users')
  }

  const { rows: existing } = await db.query(
    `select w.id from public.workspaces w
     join public.workspace_members m on m.workspace_id = w.id
     where m.user_id = $1 limit 1`,
    [userId],
  )

  let workspaceId = existing[0]?.id

  if (!workspaceId) {
    const { rows } = await db.query(
      `insert into public.workspaces (name, type, owner_id, timezone)
       values ('Demo Brand', 'business', $1, 'Asia/Dhaka') returning id`,
      [userId],
    )
    workspaceId = rows[0].id

    await db.query(
      `insert into public.workspace_members (workspace_id, user_id, role)
       values ($1, $2, 'owner')
       on conflict (workspace_id, user_id) do nothing`,
      [workspaceId, userId],
    )

    await db.query(
      `insert into public.profiles_setup (workspace_id, brand_name, industry, description, completed_at)
       values ($1, 'Demo Brand', 'Coffee', 'A demo workspace, seeded for a first look at the app.', now())
       on conflict (workspace_id) do nothing`,
      [workspaceId],
    )
    console.log('  workspace created')
  } else {
    console.log('  existing workspace reused')
  }

  await db.query(
    `update public.users
        set onboarding_step = 'done',
            onboarding_completed_at = coalesce(onboarding_completed_at, now()),
            active_module = 'business',
            active_workspace_id = $2,
            full_name = coalesce(full_name, 'Demo Owner')
      where id = $1`,
    [userId, workspaceId],
  )

  // Section 6.1's claim is a PARTIAL unique index — it covers only `active` and
  // `needs_reconnect` rows. `on conflict` cannot infer a partial index without
  // repeating its predicate, so this asks first rather than guessing.
  const externalId = `demo-page-${String(workspaceId).slice(0, 8)}`
  const { rows: already } = await db.query(
    `select id from public.social_accounts
      where platform = 'facebook' and external_account_id = $1
        and status in ('active', 'needs_reconnect')`,
    [externalId],
  )

  if (already.length) {
    await db.query(`update public.social_accounts set status = 'active' where id = $1`, [already[0].id])
    console.log('  connection already present, set back to active')
  } else {
    await db.query(
      `insert into public.social_accounts
         (workspace_id, platform, external_account_id, external_username, display_name,
          account_type, status, paid_seat, connected_by, connected_at, scopes)
       values ($1, 'facebook', $2, 'demo.brand', 'Demo Brand Page',
               'page', 'active', true, $3, now(), array['pages_show_list','pages_manage_posts'])`,
      [workspaceId, externalId, userId],
    )
    console.log('  connection created (fake)')
  }

  // A few posts, so the calendar and the planner have something in them.
  // Times are future: Section 6.2's guard refuses a schedule in the past, which
  // is the rule working rather than a problem to route around.
  const { rows: postCount } = await db.query(
    'select count(*)::int as n from public.posts where workspace_id = $1',
    [workspaceId],
  )

  if (postCount[0].n === 0) {
    const sample = [
      ['New season, same good coffee', 'draft', 1, 9, 30],
      ['Spring collection lands on Friday', 'scheduled', 2, 11, 0],
      ['Behind the counter this morning', 'scheduled', 2, 15, 30],
      ['Better places ahead', 'scheduled', 4, 18, 0],
      ['A quiet week, on purpose', 'draft', 6, 8, 0],
    ]

    for (const [caption, status, inDays, hour, minute] of sample) {
      await db.query(
        `insert into public.posts (workspace_id, caption, status, created_by, scheduled_at)
         values ($1, $2, $3, $4,
                 ((now() at time zone 'Asia/Dhaka')::date + $5 * interval '1 day'
                  + make_interval(hours => $6, mins => $7)) at time zone 'Asia/Dhaka')`,
        [workspaceId, caption, status, userId, inDays, hour, minute],
      )
    }
    console.log(`  ${sample.length} sample posts created`)
  } else {
    console.log(`  ${postCount[0].n} posts already present`)
  }

  /**
   * A back catalogue, so the dashboard chart has a shape.
   *
   * These are `published` with dates in the past, which is what analytics is
   * actually about — and the schedule guard only refuses a *scheduled* post in
   * the past, so history inserts cleanly.
   */
  const { rows: publishedCount } = await db.query(
    "select count(*)::int as n from public.posts where workspace_id = $1 and status = 'published'",
    [workspaceId],
  )

  if (publishedCount[0].n === 0) {
    const history = [
      'Monday opening hours', 'The new grinder', 'Weekend blend', 'Staff pick: Yirgacheffe',
      'Rainy day special', 'Behind the roast', 'Two years of us', 'Cold brew is back',
      'A note on our beans', 'Sunday slow morning', 'New cups', 'Our tiny kitchen',
      'What we play in store', 'Late opening Thursday', 'Meet Rina', 'The corner table',
    ]

    for (const [index, caption] of history.entries()) {
      // Every 5 days back from a week ago, at a plausible hour.
      const daysAgo = 7 + index * 5
      await db.query(
        `insert into public.posts (workspace_id, caption, status, created_by, scheduled_at)
         values ($1, $2, 'published', $3,
                 ((now() at time zone 'Asia/Dhaka')::date - $4 * interval '1 day'
                  + make_interval(hours => $5)) at time zone 'Asia/Dhaka')`,
        [workspaceId, caption, userId, daysAgo, 9 + (index % 8)],
      )
    }
    console.log(`  ${history.length} published posts backfilled`)
  } else {
    console.log(`  ${publishedCount[0].n} published posts already present`)
  }

  await db.query('commit')
} catch (error) {
  await db.query('rollback')
  console.error('seeding failed:', error.message)
  await db.end()
  process.exit(1)
}

await db.end()

console.log('\n  email:    ' + email)
console.log('  password: ' + password)
console.log('\n  Sign in at /login. The connected Page is not real — anything that')
console.log('  calls Facebook will fail on it until a Meta app exists.\n')
