# motif Social — build log

Source of truth for scope: `media-project-note (3).md` (v4).
Section numbers below refer to that note.

## Status

| # | Module | Note ref | Status |
|---|--------|----------|--------|
| 0 | Scaffold & wiring | §9 | done |
| 1 | Data model + RLS | §10, §6 | done |
| 2 | Auth & router gate | §4 gate 1 | done |
| 3 | Onboarding state machine | §5 | done |
| 4 | Connections (FB + IG) | §6.1 | done |
| 5 | Posts & calendar | §6.2 | done |
| 6 | Queue & publishing | §4, §9 | done |
| 7 | Billing, regions, publish gate | §7, §7A | todo |
| 8 | Notifications | §11 Phase 1 | todo |
| 9 | BD + Global landing | §7A.1 | todo |

Phase 2 (AI Planner, credit ledger, approvals, Self/MOTiF, LinkedIn + YouTube,
analytics, transfers) and Phase 3 (TikTok, X, WhatsApp control) follow Phase 1.

## Decisions taken while building

Defaults from §13, applied unless overridden:

- Q1 starter AI credits: **yes**, `STARTER_AI_CREDITS = 50`, so onboarding Step 3
  works before payment.
- Q2 credits: monthly grant expires at cycle end, top-ups roll over.
- Q3 free trial: **none**. Scheduling and publishing are fully paid (§7.1).
- Q4 Self (MOTiF): internal, billing-exempt.
- Q5 downgrade: credit on next invoice, not a cash refund.
- Q6 global gateway: **unresolved.** Global payments sit behind a
  `PaymentGateway` interface. SSLCommerz is implemented; the global adapter is a
  stub. Swapping in Paddle / Lemon Squeezy / Stripe is one file.
- Q7 global launch: built together with BD, gated by the gateway adapter.

## Module 0 — scaffold (done)

- Next.js 16 (App Router, `src/`), React 19, TypeScript, Tailwind 4.
- `src/lib/env.ts` — public vs server env split, validated by zod at import.
  Importing `serverEnv` into a client component fails the build on purpose.
- `src/lib/constants.ts` — the domain vocabulary from the note: platforms,
  modules, onboarding steps, the post state machine and its legal transitions,
  connection statuses, roles with ranks, billing regions.
- `src/lib/supabase/{client,server,admin,middleware}.ts` — browser, request-scoped
  (RLS applies), service-role (RLS bypassed, no user in scope), and the session
  refresher.
- `src/lib/region.ts` + `src/middleware.ts` — region *hint* from
  `x-vercel-ip-country`, stored in a cookie. Display only; no price is read from
  it (§7A.3).
- `.env.example` — the full environment contract.

Middleware intentionally enforces neither gate. Both gates live in server code
next to the data, so a request that dodges middleware still meets them.

## Module 1 — data model (done)

Nine migrations in `supabase/migrations`. Every table has RLS on, and a table
with no policy for an action refuses that action to every client — that is how
the server-only tables (`gateway_events`, `notification_deliveries`) stay
server-only.

Rules that live in the database, not just in the app, because Section 4 says a
crafted API call must get no further than the UI — and because the publish
worker writes with the service role, which skips RLS but not triggers:

- **Post state machine** (§6.2) — `guard_post_transition` rejects any move not
  in the table. Mirrors `POST_TRANSITIONS` in `constants.ts`.
- **Publishing lock** (§6.2) — a post being published cannot be edited, dragged,
  paused or deleted. Only the worker may move it to `published` or `failed`, and
  not while changing its content.
- **No scheduling into the past** (§6.2), with a minute of slack for clock skew.
- **One live claim per social account** (Decision #7, §6.1) — partial unique
  index on `(platform, external_account_id)` covering only `active` and
  `needs_reconnect`. Disconnected and transferred rows keep the history but
  release the claim, so reconnecting and transferring both work.
- **Last owner cannot leave** (§6.3).
- **Billing region freezes after the first payment** (§7A.2) — the trigger
  blocks the service role too; a region change is a cancel-and-reissue at
  renewal, not an UPDATE.
- **Replayed gateway callbacks are inert** (§7.2, §7A.3) — unique
  `(gateway, gateway_transaction_id)` on payments, unique `(gateway, event_id)`
  on the raw event log.
- **An AI request is metered once** (§7.2) — unique `(workspace_id, request_id)`
  on `use` ledger rows.

Two privacy rules are enforced with column grants, because RLS filters rows and
not columns:

- OAuth tokens on `social_accounts` are not readable by any browser client.
- `account_transfer_requests.from_workspace_id` is not readable by the
  requester — §6.1 says the holder of a contested account must never be
  revealed.

`ai_credit_balance(workspace)` sums the append-only ledger, ignoring lapsed
grants. Monthly grants carry an expiry, top-ups do not (§13 Q2).

### Not yet verified

There is no Docker on this machine, so `supabase start` cannot run and the
migrations have **not been executed against a real Postgres**. They have been
read back carefully and four defects were fixed in review (OLD referenced in
INSERT/DELETE trigger paths, a CASE cast, and column-level REVOKEs that
Postgres ignores after a table-level GRANT). Treat the first successful
`supabase db push` as the real test.

`src/types/database.ts` is hand-written to match these migrations for the same
reason. Replace it with `npm run db:types` output once a database is reachable.

Plan prices in `0009` are **placeholders**. The note fixes the billing unit and
the currencies, not the numbers.

## Module 2 — auth and the router gate (done)

Gate 1 of the two in Section 4, plus the screens around it.

`src/lib/auth/gate.ts` is the gate. `evaluateGate()` returns a verdict and
`requireDashboard()` acts on it, in this order:

1. not signed in -> `/login`
2. email not verified -> `/verify-email` (Section 5, rule 2: before any OAuth)
3. `onboarding_step` is not `done` -> the saved step (Section 5, rule 1)
4. onboarding done but no workspace -> back to setup, rather than an empty
   dashboard; this is also what a removed member looks like (Section 6.3)
5. no `active` connection -> `/reconnect` (Section 6.1, last account
   disconnected)
6. otherwise, through

It lives in the `(app)` layout, not in the proxy, and re-runs on every render of
every page in the group. A proxy can be routed around; a check inside the page's
own render cannot be. `needs_reconnect` deliberately does not count as active —
a connection whose token has expired cannot publish, so letting it through would
hand the user a calendar that fails silently.

`/reconnect` sits outside the `(app)` group, because the gate protecting that
group is what redirects to it.

Other decisions here:

- `getUser()` everywhere, never `getSession()`. The session comes from a cookie
  the browser controls; `getUser()` verifies the JWT with Supabase. Every
  downstream check is an authorisation decision, so it has to be the verified
  one. Both it and the active workspace are wrapped in React `cache`, so the
  layout, the gate and the page share one fetch per request.
- Sign-in redirects to `/dashboard` as a *request*, not a destination — the gate
  there decides where the user actually lands.
- Sign-up never distinguishes "already registered", which would confirm an
  address to a stranger.
- `/auth/confirm` only ever moves onboarding forward, so an old verification
  link clicked later cannot drag a finished user back to step one.
- `/auth/callback` accepts `next` only when it is a single-slash internal path,
  so an invite link cannot bounce a freshly signed-in user off-site.
- `publicEnv()` and `serverEnv()` are both lazy: a build has no reason to hold
  credentials, and validating at import time made `next build` fail without
  them.

UI tokens are defined once in `globals.css` for light and dark and bridged into
Tailwind, so no component hard-codes a colour.

## Module 3 — onboarding (done)

The saved state machine from Section 5, and the four steps from Section 4.

`src/lib/onboarding/steps.ts` holds the single ordering the whole thing depends
on. Every advance goes through `furthest()`, which picks whichever step is
further along — so a double submit, a stale tab or a back button can never move
a user backwards. `onboarding_completed_at` is stamped only on `done`.

Pages, each guarding its own position in the order so a later step cannot be
reached by typing its URL:

- `/onboarding/module` — Personal or Business. Self (MOTiF) is not on the
  screen *and* not in the server action's schema, so a crafted POST cannot pick
  it either (Section 3).
- `/onboarding/setup` — creates the workspace, the owner membership and
  `profiles_setup` in one action. Re-running it edits rather than creating a
  second workspace. Returning to it shows what was saved, which is what
  "resume anywhere" should feel like.
- `/onboarding/connect` — Section 5 rule 3, no skip. The button is disabled
  when nothing is connected, but that is only politeness: the action re-checks
  `hasActiveConnection` server-side, so a re-enabled button gets the same
  refusal. The four OAuth failure branches from Section 6.1 have their copy
  written and wired to query parameters; Module 4 supplies the real flow. The
  blocked-account message names no workspace and no owner.
- `/onboarding/first-draft` — rule 4. Soft, skippable, and what it writes is a
  `draft` with no `scheduled_at` and no targets, so no queue can pick it up.
- `/onboarding/paywall` — rule 5. Prices read from `plans` by region; the
  region shown is a guess from the toggle or the signup country, and Section
  7A.2 rule 3 means the payment method still decides. "Pay later" finishes
  onboarding into unpaid mode, and unlocks nothing — publishing is behind gate
  2, which is still shut.

"Save and exit" lives in the layout header, since progress is already on the
user row and leaving loses nothing.

### Verified

`npm run build` (14 routes), `npm run typecheck`, `npm run lint` all pass.
`next start` boots, the proxy runs, and the env validator stops the request
naming the one missing variable — which is the wiring working, not a fault.

### Still blocked on

- `NEXT_PUBLIC_SUPABASE_ANON_KEY` is not set, so no request can complete.
- The migrations have still never been run against the project.

## Module 4 — connections (done)

Section 6.1, end to end, minus the Meta credentials.

**Token vault.** `src/lib/crypto/aes.ts` is AES-256-GCM with no dependency on
config, so it can be tested directly; `tokens.ts` wraps it with the key from the
environment. Payloads carry a `v1.` prefix so a future key rotation can read old
rows while re-encrypting them. Tokens are bound to their account with the AAD
`social_account:<workspace>:<platform>:<external id>` — moving a row's
ciphertext to another connection fails to decrypt rather than quietly
publishing to the wrong page. 13 tests cover the round trip, tampering,
malformed input, version refusal, wrong key and that binding.

**One live claim per account** (Decision #7). `claimAccount` does not look
first and then insert — a read followed by a write has a gap. It inserts and
lets the partial unique index decide, so two users racing on the same account
resolve cleanly and the loser is told the account is elsewhere without ever
learning where. A row this workspace previously disconnected is revived instead
of duplicated, keeping its history and its seat.

**Nothing is auto-connected.** The callback stores the platform token in
`oauth_sessions` — a new table with no RLS policy at all, reachable only with
the service role — and sends the user to a picker with nothing ticked. Section
7.1 bills per connected account, so claiming every Page a user administers
would charge them for pages they never asked for. The picker re-fetches the
list from the platform on render, so a form cannot offer an account the token
does not cover.

**CSRF.** The `state` parameter is a bare nonce; what it means (workspace,
platform, return path) stays in an encrypted httpOnly cookie. A forged callback
carries a nonce matching no cookie; a stolen cookie carries a nonce that cannot
be guessed. The cookie is consumed whether or not it matched, so a replayed
callback finds nothing. Signing a fat state parameter instead would leak the
workspace id into Meta's logs and the browser's history for no benefit.

**Disconnect** cancels that account's pending targets and pauses a post only
when nothing publishable is left — otherwise disconnecting Instagram would
silently stop a post that was also going to Facebook. The seat stays paid to
the end of the cycle (§7.2), so `seat_paid_until` is untouched.

**Token refresh** runs six-hourly and starts a week before expiry. Meta has no
refresh token: a long-lived token is traded for a fresh one while the old one is
still valid, so letting it lapse means there is nothing to trade. A refusal from
the platform is not retried — it means access was revoked — and the connection
drops to `needs_reconnect`, its posts pause, and a workspace-wide notification
is queued, since whoever connected the account may have left.

**Transfer requests** open a case and nothing more. `from_workspace_id` is
filled in server-side for support and is revoked from client reads, so the page
literally cannot tell the requester who holds the account.

### Gate change

`requireWorkspace` now sits alongside `requireDashboard`. Section 4 blocks the
*dashboard* on a live connection, not the whole application — Connections,
Billing and Settings must stay reachable in exactly the state that fails that
check, or `/reconnect` would link into a loop and an unpaid workspace could
never reach checkout.

### Verified

`build` (20 routes), `typecheck`, `lint`, and 13 passing crypto tests.

### Not verified

No Meta app credentials, so no OAuth round trip has been run. `META_GRAPH_VERSION`
defaults to `v23.0` and must be confirmed in the Meta dashboard — Meta ships a
version quarterly and retires them after about two years. The migrations still
have not been executed.

## Module 5 — posts and calendar (done)

Section 6.2, plus gate 2 from Section 4, which scheduling needs before Module 7
can supply the payments that open it.

**Time.** `src/lib/time.ts` is the only place UTC and workspace-local meet.
A `datetime-local` input has no zone of its own, so "09:00" is read in the
*workspace's* zone rather than the browser's — which is what stops a travelling
editor shifting when the team's 9am post goes out. The tests caught a real bug
here: `2026-13-01` rolled silently into January 2027 instead of being rejected,
and 31 April would have done the same. Both are now refused, checked by
comparing the constructed date against the one asked for.

**Validation.** `src/lib/posts/validation.ts` is pure — no database, no network
— so the composer and the server run the identical function and cannot disagree.
Facebook takes text on its own; Instagram refuses to publish without an image.
An awkward aspect ratio warns rather than blocks, because the platform accepts
it and crops, and it is the user's picture. An unmeasured file is not judged on
dimensions it does not have.

**Gate 2** (`src/lib/billing/entitlements.ts`) refuses scheduling without an
active subscription covering *those* accounts — not the workspace in general.
It re-runs on resume, because a plan may have lapsed or a seat been lost while
a post sat paused. Billing-exempt workspaces (§13 Q4) pass on a flag rather
than on their type, so a one-off exemption needs no code change.

**Media.** Bytes go from the browser straight to Supabase Storage; a 200MB video
has no business passing through a serverless function. The bucket is private,
so previews are signed per render — a leaked object path should not be a
permanent view of an unpublished campaign. Storage policies read the workspace
out of the object key's first path segment, so an object is governed the moment
it is written, before any row exists. The server re-checks the object is really
there before registering metadata.

**Removing a published post** is the one action that looks destructive and is
not. The confirm says "This stays live on [platform]" before the second click,
as the note specifies.

Two smaller decisions worth recording:

- "Save as draft instead" is a named submit button, not an `onClick` that
  clears state — React would not have re-rendered before the form posted, so
  the old time would have gone with it.
- `post_targets` idempotency keys are minted once and never regenerated, so a
  target surviving an edit keeps the key it would publish under (§6.2, double
  publish).

### Verified

`build` (23 routes), `typecheck`, `lint` clean, **41 tests passing** — 13
crypto, 13 time, 15 validation.

### Still not verified

The migrations have never run, so none of this has touched a real database.

## Module 6 — queue and publishing (done)

Section 4's publish flow and Section 9's "Queue: due posts (every minute)".

**The queue is `post_targets`, not a second table.** A jobs table would be two
rows that can disagree about whether a post went out, and reconciling them is
precisely the bug §6.2 is worried about. Migration `0012` adds only the
bookkeeping a claim needs: a lease, a next-attempt time, and the Instagram
container id.

**The claim is one statement.** `claim_due_targets` selects due targets
`for update ... skip locked` and updates them in the same query, then moves
their posts to `publishing` in the same transaction. Two ticks running at once
— which Vercel permits, and which "Publish now" causes deliberately — divide
the work instead of duplicating it. The second worker steps over the rows the
first is holding rather than queueing behind them and publishing them again.

Only posts still `scheduled` are moved. The lock trigger raises on any update
to a publishing post that does not change its status, so touching one whose
sibling target claimed it a minute ago would abort the whole claim.

**Three ways a publish can fail, and they are not the same.** `policy.ts` is
pure and tested, and it separates:

- *retryable* — would this work if repeated? A 500 or a rate limit, yes; a
  revoked token or a rejected caption, no. Retrying a permanent failure burns
  the attempt budget and delays the notification the user actually needs.
- *safe to repeat* — might it have worked already? A timeout after the request
  was accepted is indistinguishable from one before it.
- *still processing* — Instagram is working on a container we already handed
  it. Not a failure at all: the attempt is refunded and the next tick resumes.

**The double-publish problem, honestly.** The Graph API has no idempotency key,
so ours is never sent — it identifies the attempt in our own logs and nothing
more. What actually prevents a duplicate is three things: the single-flight
claim, the stored Instagram container id (a retry publishes *that* container
rather than building a second one), and `findRecentlyPublished`, which goes and
looks at the account before any retry that follows an ambiguous failure.

That reconciliation matches on the caption, which means **a post with no
caption cannot be identified**, and the adapter says so by returning null. The
worker reads null as "do not retry". So the worst case is a post somebody has
to check by hand — never the same post twice in a client's feed.

**What the worker re-checks before sending**, because a post can sit in the
calendar for weeks: the post is still publishing, the account still exists and
is still `active`, gate 2 still covers *that* account, the token still decrypts,
the media still exists. Each is a different sentence in the UI, because each is
a different thing for the user to do.

A gate-2 refusal at publish time **fails** the target rather than pausing it.
The post is already `publishing` and §6.2's state machine has no way back from
there; `failed` is a state the user can reschedule out of once they have sorted
the plan out. Pausing scheduled posts when a plan lapses is Module 7's job, in
the billing cron — this is the backstop, not the mechanism.

**Waiting has a deadline.** Waiting on a container costs no attempt, which
means without a clock a container Meta never finishes would be picked up and
put back every minute for ever. Thirty minutes from the scheduled time, it is
reported as failed.

**Rescheduling revives failed targets, not published ones.** A post that went
out on Facebook and failed on Instagram, then rescheduled, retries Instagram
only. "Try the whole thing again" is exactly how a double publish happens.

**"Publish now"** (§6.2, the answer when a chosen time has passed) does not
publish inline — that would hold a serverless function open through a video
upload and lose the post if the tab closed. It puts the post at the front of
the same queue and nudges the worker with `after()`, so the click takes effect
without waiting for the next minute's cron. Nothing about the post's state
depends on that nudge arriving; the cron is the backstop.

**Two `security definer` functions were a hole waiting to happen.** Postgres
grants EXECUTE to PUBLIC by default, so `claim_due_targets` would have been
callable over PostgREST by any signed-in browser — marching every workspace's
queue forward. All three new functions are revoked from `public, anon,
authenticated` and granted to `service_role` only. `purge_expired_oauth_sessions`
from migration 0010 had the same oversight and is fixed here rather than left
as a pattern to copy.

### Verified

`build` (24 routes), `typecheck`, `lint` clean, **67 tests passing** — 13
crypto, 13 time, 15 validation, 13 publish planning, 13 retry policy.

### Not verified

- The migrations still have never run. `0012` in particular leans on
  `for update ... skip locked`, a data-modifying CTE and `make_interval` — all
  read back carefully, none executed. Treat the first `supabase db push` as the
  real test.
- No Meta credentials, so **nothing has ever been published**. Every Graph call
  in `meta.ts` is written from the documented API and has not met the real one.
  The error-code classification lists in particular are the kind of thing that
  is only right after seeing production traffic.
- Vercel cron is minute-granularity on a paid plan; `maxDuration = 60` assumes
  the Hobby ceiling. Both want confirming against the actual account before
  launch.

### Known gap

A post left `scheduled` with no claimable target — every target cancelled by a
disconnect that then failed to pause the post — would sit in the calendar
looking scheduled for ever. The paths that cancel targets do pause the post, so
this needs two failures at once, but nothing sweeps for it. Worth a check in
Module 8's cron.
