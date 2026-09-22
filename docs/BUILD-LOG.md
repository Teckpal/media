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
| 7 | Billing, regions, publish gate | §7, §7A | done |
| 8 | Notifications | §11 Phase 1 | done |
| 9 | BD + Global landing | §7A.1 | done |
| 10 | Local database harness | §10 | done |
| 11 | Cron jobs that admit failure | §9 | done |
| 12 | Schema live on Supabase | §9, §10 | done |
| 13 | Landing pages rebuilt | §7A.1 | done |
| 14 | Calendar drag + dashboard chart | §6.2, §11 | done |

Phase 1 is complete as code. Phase 2 (AI Planner, credit ledger, approvals,
Self/MOTiF, LinkedIn + YouTube, analytics, transfers) and Phase 3 (TikTok, X,
WhatsApp control) follow.

**The schema is live on Supabase** (`koiimpnvaxadigwiuhbk`, ap-south-1,
Postgres 17.6). Signup, the mirror trigger, RLS and the publish gate all work
against it — see Module 12.

**Two things still block launch, and neither is code:**

1. No Meta, SSLCommerz or Resend credential exists, so no OAuth round trip, no
   payment and no real email has happened. Every other value in `.env.local` is
   a working placeholder, and `CRON_SECRET` and the webhook tokens are real
   random values.
2. Prices are placeholders, BD VAT is unconfirmed, and the legal pages have
   not been near a lawyer.

**The migrations have now run** — see `scripts/local-db`. The first item on
this list used to be that they had never been executed anywhere.

Note on `AUTH_JWT_SECRET`: it is now empty and unused on purpose. The new API
key format is opaque, not a JWT signed with a project secret; tokens are
verified against the project's JWKS endpoint instead.

## Decisions taken while building

Defaults from §13, applied unless overridden:

- Q1 starter AI credits: **yes**, `STARTER_AI_CREDITS = 50`, so onboarding Step 3
  works before payment.
- Q2 credits: monthly grant expires at cycle end, top-ups roll over.
- Q3 free trial: **none**. Scheduling and publishing are fully paid (§7.1).
- Q4 Self (MOTiF): internal, billing-exempt.
- Q5 downgrade: credit on next invoice, not a cash refund.
- Q6 global gateway: **still unresolved**, and now unresolved behind a working
  interface. `PaymentGateway` (Module 7) has SSLCommerz implemented end to end;
  the global adapter reports itself unconfigured, so the Global paywall says so
  rather than offering a button that cannot work. Swapping in Paddle / Lemon
  Squeezy / Stripe is one file.
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

## Module 7 — billing, regions and the publish gate (done)

Sections 7, 7A and 13 Q5. Gate 2 finally has something behind it.

**One rule shapes the whole module** (§7A.3): "the server reads the price from
the DB by region + package. Never trust a price sent from the browser." So the
only thing a form posts is a plan *code*. There is no field anywhere in the
checkout path through which an amount could travel, and `startCheckout` reads
every number from `plans` or computes it from what it read.

**The arithmetic is pure and tested; the application of it is atomic.**
`pricing.ts` knows about months, pro-ration, downgrade credit and tax order and
touches nothing else — 22 tests. Applying a payment is the opposite problem:
marking the invoice paid, extending the subscription, locking the region,
paying the seats and granting the month's AI credits are one event, and
supabase-js has no transaction. So they happen inside `activate_paid_invoice`
(migration 0013) in one statement. A failure halfway cannot leave a customer
charged and not activated.

**Money never touches a float.** `amounts.ts` converts between our integer
minor units and the decimal strings gateways speak, by string arithmetic.
`parseFloat('1.15') * 100` is 114.999…, which is a poisha short on every
invoice ending in 15 — right almost always, and very hard to find in a log.

**Only the server-to-server callback may mark an invoice paid** (§7.2). The IPN
route writes the raw event *before* acting on it, so the unique
`(gateway, event_id)` recognises a replay; then it asks SSLCommerz directly
with `val_id` and checks three things — the gateway says valid, the transaction
is the one we asked about, and the amount and currency are the invoice's own. A
genuine payment for the wrong amount is not a payment of this invoice.

The customer's own return from the payment page runs the same settlement, since
an IPN can be slow and someone who has just paid should not be shown an unpaid
account. It is public and unauthenticated on purpose: SSLCommerz returns the
browser with a cross-site POST that carries no session cookie, and there is
nothing to protect — the route settles by transaction id and validates before
believing anything.

**Region is decided by the gateway that took the money.** §7A.2 rule 3 says the
payment method has the final word, and that is implemented rather than asked
about: SSLCommerz cannot settle a non-BD card, so a completed SSLCommerz
payment *is* the evidence. The region locks on the first successful payment
(rule 4). A payment arriving against an already-locked, contradicting region is
flagged for support rather than thrown away — the money is real.

**The renewal cycle is ours, not the gateway's** (§7.2), because SSLCommerz is
one-time checkout. The daily sweep raises the next invoice seven days out,
reminds at 7, 3 and 1 days, allows three days of grace past the due date, and
only then withdraws publishing — pausing scheduled posts rather than cancelling
them. Drafts, connections, media and the calendar all stay. A customer who pays
late finds everything where they left it.

**Two bugs found while wiring it up**, both worth recording:

- *Gate 2 was broken for everyone but the owner.* `canPublish` reads
  `subscriptions`, but migration 0008 makes that table owner-only (§6.3: "Admin:
  everything except billing"). An editor opening the composer was told to buy a
  plan their workspace already had. Fixed with `publishing_coverage`, a
  security-definer function that answers the narrow question any member is
  entitled to ask — covered, and until when — and exposes no amounts. The
  owner-only policy on invoices is untouched.
- *An early renewal would have flipped a healthy subscription to past due.*
  The dunning sweep originally read overdue from open invoices; an owner
  renewing mid-cycle raises one payable now, for a cycle that has not started.
  It is now driven from the subscription's own period end, which is what
  "overdue" actually means. An early renewal also now extends the cycle from
  the current period end rather than restarting it, which would have quietly
  shortened the month they had already bought.

**The global gateway refuses honestly.** §13 Q6 is still unanswered — Paddle,
Lemon Squeezy and Stripe differ on who is merchant of record, which is a tax
question rather than a code one. The stub returns `isConfigured() === false`,
so the Global paywall says so instead of offering a button that cannot work.
A stub that quietly succeeded would be far worse: a workspace would believe it
had paid, lock its billing region, and get a publish gate that opens on nothing.
Answering Q6 replaces one file.

**An exempt workspace can no longer be charged** (§13 Q4). Self / MOTiF
publishes without a plan, and checkout now refuses it rather than taking money
it should not — a bug that would have come with a receipt.

### Verified

`build` (28 routes), `typecheck`, `lint` clean, **112 tests passing** — 13
crypto, 13 time, 15 validation, 13 publish planning, 13 retry policy, 22
pricing, 12 amounts, 11 IPN signature.

### Not verified

- The migrations still have never run. `0013` is the heaviest SQL in the
  project so far: three security-definer functions, a cursor `for update` loop
  and one long activation transaction, all read back rather than executed.
- **No payment has ever been taken.** There are no SSLCommerz credentials, so
  the session API, the IPN and the validation API have all been written from
  the documentation and none has met the real thing. The sandbox round trip is
  the first thing to do when credentials exist.
- Plan prices in `0009` are still placeholders, and BD VAT is still with the
  accountant. `quoteSubscription` takes a tax rate as an input and nothing sets
  it yet — applying VAT is a configuration change, not a rewrite.

### Known gaps

- Mid-cycle seat purchase is quoted (`quoteAddedSeats`, tested) but has no
  screen yet. Connecting an account beyond the paid count leaves it draft-only,
  which is what §7.2 says should happen; buying the extra seat means renewing.
- Plan *downgrade* creates no credit yet. `downgradeCreditMinor` exists and is
  tested, and `billing_credits` is consumed properly at checkout — what is
  missing is the screen that calls it.
- Nothing reconciles a payment that stays `pending` because the IPN never
  arrived and the customer never came back. After 24 hours it is closed as
  incomplete, which is honest but not the same as asking the gateway.

## Module 8 — notifications (done)

Section 11, Phase 1: in-app and email. The rows Modules 4, 6 and 7 have been
queueing all along now reach someone.

**A schema mistake, found by trying to use it.** `notifications.read_at` is one
column on one row, but a notification with a null `user_id` is addressed to the
whole workspace — which Modules 4, 6 and 7 all do deliberately, because whoever
connected an account or scheduled a post may have left (§6.3). Read state for a
shared row is per person, and one column cannot hold it: the first member to
open the list would have marked it read for everybody. Migration 0014 moves
read state to `notification_reads`, keyed by (notification, user), for shared
and personal alike. `read_at` is left in place with a comment saying what
replaced it, rather than dropped.

**The fan-out is a trigger, not a call.** Four files across three modules
already insert notifications and Module 9 will add more; one of them forgetting
to enqueue an email is exactly the omission nobody notices until a customer
says "you never told me". So `notifications_fan_out` writes the delivery rows
on insert — in-app already marked sent, because the row existing *is* the
delivery, and email pending. Nothing is queued for WhatsApp: it is Phase 3
(§8), and an empty queue beats one full of rows nothing will ever pick up.

**Two filters decide who gets an email, and they answer different questions.**
Eligibility is about the workspace — a notification goes to people who could
act on it, so a renewal reminder stops at the owner, since §6.3 gives nobody
else the ability to pay it, and a viewer is never the audience for anything.
Preference is about the person, applied afterwards. In-app is subject to
neither: turning email off must never mean being kept in the dark.

**Routine success is not emailed.** A workspace publishing ten posts a day to
two platforms produces twenty `post_published` notifications. Emailing all of
them would train every editor to filter the address that also carries "your
account needs reconnecting". They are shown, counted on the bell and kept — the
email is what is withheld, and the delivery row says so rather than vanishing.

**The email templates escape everything and link almost nothing.** A
notification body carries a post caption, an account name and a gateway's error
message, all of it text somebody else wrote; unescaped in HTML, a caption is an
injection into a mail client. And only a plain single-slash internal path
becomes a link — `//evil.example`, `javascript:`, a backslash — all refused, so
a row in a table can never put an attacker's URL behind our from-address. Both
rules are tested, and both are why `templates.ts` is pure.

**Delivery is claimed the way publishing is** (`skip locked`, attempts, the
same backoff curve imported from the publish worker rather than a second one
that drifts out of step). One deviation worth recording: a *partial* success
counts as sent. There is one delivery row per channel, so retrying would
re-send to everyone who already received it — and a failure against one address
is almost always that address, not the queue. The failures are recorded on the
row instead.

**Settings exists now.** The navigation had always linked to `/settings` and
nothing was there; it now holds the email preferences, since they have to live
somewhere a person can find them. The rest of §3's settings arrive with the
modules that own them.

### Verified

`build` (32 routes), `typecheck`, `lint` clean, **136 tests passing** — 24 new
(13 email rendering and link safety, 11 routing and audience).

### Not verified

- The migrations still have never run. `0014` adds the first `after insert`
  trigger that writes to another table, and the read-state policy leans on a
  correlated `exists` against `notifications` — read back, not executed.
- **No email has ever been sent.** `RESEND_API_KEY` is unset and `EMAIL_FROM`
  is still `noreply@example.com`, so the dispatcher will skip every delivery
  with "No email provider is configured" until both are set and the sending
  domain is verified with Resend. That skip is deliberate: a queue of pending
  rows would hide the fact that nobody is being told anything.

### Known gaps

- No digest or coalescing. Ten posts failing at 9am is ten emails. A per-hour
  digest per category is the obvious next step and is not built.
- The bell count is rendered per request. It updates on navigation and after
  marking something read, not on its own — there is no subscription or polling.
- WhatsApp (§8) remains Phase 3. The table, the channel enum and the audit
  `source` are all in place; nothing writes to them.
- `notifications.read_at` and 0008's `notifications_update_own` policy are now
  vestigial. They are harmless, and removing a policy is a migration for a day
  when there is a reason to touch that file.

## Module 9 — BD and Global landing (done)

Section 7A.1: two front doors. The create-next-app placeholder at `/` is gone.

**Two pages, one component.** The regions differ in price, in how money moves
and in who the page is addressed to — not in what the product does. The
structure lives in one component so the Bangladesh page cannot quietly fall a
feature behind the other one, and the copy lives in `marketing/copy.ts` where
all the claims can be read in one sitting.

**The copy has rules, and they are tested.** No page may quote a price — §7A.3
puts prices in the database, and a number typed into marketing copy is a number
still there six months after the price changed. No page may name a platform
that is not built: LinkedIn, YouTube and TikTok may be mentioned, but only
alongside a word that places them in the future. The Global page may not imply
a card checkout, because §13 Q6 has not chosen a provider and Module 7's global
gateway is honestly a stub. Ten tests hold those lines.

**IP suggests; it does not redirect.** A visitor whose region hint is `bd` gets
a banner on `/` offering `/bd`, and vice versa. Sending someone somewhere they
did not ask to go on the strength of an IP address is impossible to argue with
when the guess is wrong, and it would make `/` an unstable thing to share. The
toggle in the header is a plain form posting to a server action, so it works
before JavaScript arrives — which on a landing page, often on a slow
connection, is not a theoretical concern.

**Privacy and terms are a dependency, not furniture.** Meta requires a privacy
policy URL and data-deletion instructions before it will review an app for the
permissions Module 4 needs. Both pages describe what the code actually does —
the encrypted token vault, the private media bucket, the three-day grace, the
fact that removing a published post leaves it live on the platform — so the
terms and the software cannot quietly disagree. Both carry a banner saying they
have not been through a lawyer, rather than leaving someone to assume they have.

**`robots.ts` and `sitemap.ts`** list only what a stranger should land on, with
both regional pages at equal priority: §7A.1 treats them as two front doors
rather than a page and its variant.

### Three things the build and the browser caught

1. **A build stopped needing credentials again.** `robots.ts`, `sitemap.ts` and
   the root layout's metadata all run during `next build`, and asking
   `publicEnv()` for the site URL dragged the Supabase key validation into the
   build — breaking the promise Module 0 made deliberately. `appUrl()` now
   validates that one variable on its own.
2. **A `try/catch` was swallowing the framework.** The landing pages read the
   session through `isSignedIn`, which returns false rather than throwing so a
   database hiccup cannot take the public site down. But Next signals control
   flow with exceptions, and reading cookies during a static render throws one
   — caught silently, it broke Next's own detection of a dynamic route. The
   build log said so; `unstable_rethrow` fixes it. Any catch in a server
   component needs it.
3. **The pages were actually loaded, not just compiled.** `next start` plus
   curl: `/` and `/bd` return 200 with the right headings, titles, canonical
   and `hreflang` tags; the BD cookie produces the nudge banner on `/`; and —
   usefully — with an unreachable database the pricing section degrades to
   "our prices are not loading right now" instead of an empty grid. That is the
   first end-to-end render this project has had.

### Verified

`build` (35 routes), `typecheck`, `lint` clean, **146 tests passing** — 10 new,
all on the marketing copy's own rules. Both landing pages, both legal pages,
`robots.txt` and `sitemap.xml` fetched from a running server.

### Not verified

- Nobody has looked at these pages in a browser. They were fetched and their
  HTML inspected; the layout at phone width, in dark mode, and with real
  prices in the grid has not been seen by a human.
- The prices in the grid have never rendered from real data, because no
  database has ever run. What was observed was the fallback.
- No open-graph image. A link to either page currently previews without one,
  which is a design task rather than a code one.

### Known gaps

- The landing pages render per request, because the session read and the price
  read both need a server. For the one page a stranger loads first, that is
  slower than it needs to be; caching the plans query is the obvious
  improvement and was left alone rather than guessed at.
- Copy is English on both pages. §7A.1 does not ask for Bangla, but a Bangla
  version of `/bd` is the obvious next thing a Bangladeshi customer would want.
- The contact addresses in the legal pages are `@motif.example` placeholders,
  and the company name and address the terms need do not exist yet.

## Module 10 — the local database harness (done)

The migrations had never been executed. There was no Docker on the build
machine, so `supabase start` was out, and the hosted project's keys turn out to
be stale — the service key is rejected with `Invalid API key`, and the
`AUTH_JWT_SECRET` beside it does not sign that key, so neither can be trusted.
Fourteen migrations and 2,819 lines of SQL were still resting on a careful read.

**The dependency surface turned out to be tiny.** The migrations reference
`pgcrypto`, `auth.uid()`, `auth.users`, `storage.objects`, `storage.buckets` and
three roles. No `pg_cron`, no Vault, no Realtime. That is small enough to shim,
which means a plain Postgres can run the whole schema — and a real Postgres 17
installs as an npm dependency with no Docker and no administrator.

`supabase/local-shim.sql` supplies those objects; `scripts/local-db` starts the
cluster, applies the migrations, and checks the result. `npm run db:local` does
all of it.

### What ran

All fourteen migrations applied cleanly on the first attempt, from an empty
schema: 27 tables (RLS enabled on every one), 30 functions, 48 policies, 28
triggers, 16 enums, 84 indexes, six seeded plans. The heavy SQL that had most
needed executing — `for update ... skip locked` and the data-modifying CTE in
0012, the security-definer functions and cursor loop in 0013, the cross-table
after-insert trigger in 0014 — all work.

### Two things the database caught

1. **The hand-written types had drifted by one column.** `whatsapp_links.otp_hash`
   exists in 0007 and was missing from `WhatsappLinkRow`. One column out of 27
   tables is a good showing for 633 lines written by hand, but it is exactly the
   error that kind of file accumulates, so `db:local:verify` now compares every
   column, nullability and enum member against the live schema on demand.
2. **The cron routes cannot tell a dead database from an idle one.** With the
   Supabase key rejected, `/api/cron/publish` answers
   `{"ok":true,"claimed":0,...}` — a clean 200 with tidy zeros — while
   `[publish] claim failed: Invalid API key` goes to the log. `claimDueTargets`
   logs and returns `[]`, which is indistinguishable from "nothing due". Vercel
   cron monitoring watches the response, so this would look healthy forever
   while nothing published. **Fixed in Module 11.**

### Verified

`npm run db:local` end to end: migrations applied, 27 tables and 16 enums
matching `database.ts` with zero drift, and 24 rule assertions passing — the
cross-workspace account block, the past-date reject, the idempotency key, the
publishing edit lock, the last-owner guard and the billing-region lock all
refuse what Sections 6 and 7A say they should. `build`, `typecheck`, `lint` and
146 tests still clean. All 35 routes served by `next start`: public pages 200,
every gated route 307 to `/login`, cron routes 401 without the secret and 200
with it.

### Not verified

- **This is not Supabase.** No PostgREST, no GoTrue, no Storage, so nothing
  proves an RLS policy denies the right person — only that the policies parse
  and plan. The app cannot talk to this cluster at all.
- The 48 policies were checked for existence, not behaviour. Setting
  `request.jwt.claims` and asserting each policy's decision is the obvious next
  use of this harness and is not written.
- Postgres 17.10 here; confirm the hosted project's version before trusting
  this as a rehearsal for `supabase db push`.


## Module 11 — cron jobs that admit failure (done)

Module 10 caught it: with the database unreachable, every one of the four cron
routes answered `{"ok":true, ...zeros}` with HTTP 200. The errors went to
`console.error` and nowhere else. Vercel Cron's monitoring watches the
response, so the jobs would have reported a healthy minute, every minute, for
as long as the outage lasted — while nothing published, no email went out and
no subscription lapsed into grace.

The cause was one habit repeated in five files: a failed Supabase query and an
empty result are both falsy, and every call site collapsed them. `const { data }
= await admin.from(...)` with no `error` binding cannot tell "nothing is due"
from "the table could not be read".

**The shape of the fix.** A tick now carries `degraded: string[]` — the queries
it could not run. `cronResult()` in `lib/cron.ts` answers 200 with `ok: true`
when that list is empty and 503 with `ok: false` when it is not, so a failing
job looks like a failing job to anything watching. The counts stay in the body
either way, because "what did we manage" is still worth reporting.

- `claimDueTargets` and `reapStuckTargets` return `null` for "did not run",
  distinct from `[]` and `0`. A null claim ends the tick rather than reporting
  zero published.
- `runNotificationTick` records the exhaust sweep and the claim separately.
- The billing sweep gained `rowsOrDegrade`, because all six of its steps began
  by reading a list and discarding the error. That was the largest concentration
  of the bug: a whole sweep could silently do nothing.
- `refreshExpiringTokens` returns early rather than letting an unreadable
  `social_accounts` pass for "no tokens are expiring" — the one outcome that job
  exists to prevent.

### Verified

Against the live Supabase project, with valid keys and the schema not yet
pushed, all four routes now answer **503** and name what failed:

```
publish        degraded: reap_stuck_targets, claim_due_targets
notifications  degraded: fail_exhausted_deliveries, claim_notification_deliveries
billing        degraded: raiseRenewals, sendReminders, moveOverdueToPastDue,
                         endGracePeriods, releaseLapsedSeats, closeStalePayments,
                         expire_lapsed_ai_grants
refresh-tokens degraded: social_accounts, purge_expired_oauth_sessions
```

`typecheck`, `lint`, `build` and 146 tests clean.

### Not verified

No test asserts the degraded path. It was proven by pointing the app at a
project without the schema, which is a real reproduction but not a repeatable
one — the obvious next step is a unit test per tick with a failing client.

### Known gap

The inner queries of the billing sweep — the per-row invoice and notification
writes inside each loop — still discard their errors. A sweep that reads its
list successfully and then fails on every write still reports `ok: true` with
`invoicesRaised: 0`. The list queries were fixed because they decide whether
work happens at all; the writes want the same treatment.


## Module 12 — the schema on real Supabase (done)

The project was reachable and the keys were valid; what was missing was the
database password, and with it the whole push became possible.

**Three things had to be discovered first.**

1. **There is no direct database host any more.** `db.<ref>.supabase.co` does
   not resolve for this project — new projects are pooler-only. Migrations go
   through `aws-0-ap-south-1.pooler.supabase.com:5432`, session mode. Port 6543
   is transaction mode and would break multi-statement migration files.
2. **The project held someone else's application** — 46 tables, 56 functions,
   `tenants` / `brands` / `listings` / `conversations`. `auth.users` had zero
   rows, so no real account was ever created against it, but it was not this
   codebase. Its structure is saved in `.local-db/old-schema-columns.txt`
   before the wipe.
3. **The default privileges were wrong, and this is the one the local harness
   could never have caught.** None of the migrations grants table privileges to
   `anon` or `authenticated` — 0008 only revokes a table-wide SELECT and grants
   specific columns back, which assumes the grant already exists. On Supabase
   that assumption rests on a default ACL, and this project's `postgres`
   default ACL had been narrowed to `postgres, service_role`. Pushed as-is,
   every table would have landed unreadable by the app, with RLS never getting
   a say. `scripts/remote/push.mjs` sets Supabase's standard default privileges
   before the first `create table`, so 0008's revokes still land last.

   The local harness missed it because migrations there run as superuser, where
   grants are irrelevant. A rehearsal that cannot fail on permissions does not
   test permissions.

### What is now true

All 14 migrations applied to the live project in one pass: 27 tables, 30
functions, the `on_auth_user_created` trigger on `auth.users`, the `post-media`
bucket and its four storage policies, six seeded plans.

Verified through the real HTTP API, with real keys, as a real user:

- `npm run check:supabase` — 27 tables, 6 plans, and the anon key seeing no
  workspaces.
- `npm run db:remote:walk` — 11 assertions. A new user is mirrored into
  `public.users` by trigger and starts at `verify_email`; a password login
  returns a session; that session reads its own row and **only** its own row;
  and `social_accounts.access_token_encrypted` is **refused with 403** to an
  ordinary signed-in user. That last one is the column-grant privacy rule from
  Module 1 finally proven end to end — it could not be tested locally.
- All four cron routes answer 200 with `degraded: []`. Twenty minutes earlier
  the same code answered 503, which is what makes the zeros trustworthy.
- The BD landing page renders **BDT 499 / 899 / 1,499 from the database**. Every
  previous render of that page was the "prices are not loading" fallback.

### Two findings about GoTrue worth keeping

- **It refuses any domain with no MX record.** `@motif.test` and
  `@example.com` are both rejected as `email_address_invalid`, so no reserved
  test domain can sign up. Real users at a misspelled or dead domain are
  rejected before the app sees them — good, but the signup form should say so
  clearly rather than showing a generic failure.
- **The built-in mailer rate-limits at a couple of sends per hour.**
  `over_email_send_rate_limit` arrived after two attempts. That is a free-tier
  limit on Supabase's shared SMTP, and it will affect real signups on launch
  day. Configuring a real SMTP provider is a launch requirement, not a nicety.

### Not verified

- Nobody has driven the app through a browser. The data path is proven; the
  screens are not. Signup, onboarding and the dashboard have been exercised
  through the API, not by clicking.
- Onboarding step 2 cannot complete: connecting a Facebook or Instagram account
  needs real Meta credentials.
- The old app's `media` storage bucket was left in place. It is unrelated to
  this codebase and holds nothing we wrote.
- `db:remote:push` bypasses `supabase link`, so the CLI's own migration history
  is written by us rather than by the CLI. A later `supabase db push` should be
  checked against it rather than trusted blindly.


## Module 13 — the landing pages, rebuilt (done)

Redrawn around the artwork, matching the design the owner pointed at: a
full-bleed hero with the networks cross-fading behind the promise, then the
networks band, a drawn dashboard, what it does, how a post gets out, what it
refuses to do, plans, short answers, closing.

**The copy is where this parts company with its model.** That page markets a
unified inbox, analytics, ten networks, white label, an MCP server and SMS.
This is Phase 1 — Facebook and Instagram, posts, calendar, queue, billing,
notifications. So the four unbuilt networks carry a badge on the card, the chip
and the caption, and `copy.ts` gained `networks`, `pillars` and `refusals`
under the tests that already refuse a page quoting a price or offering a
platform that does not work.

Approvals and team invitations are marked **coming** even though their tables,
roles and rules are all in the database. There is no screen for either, and a
ready schema is not a feature.

### Verified

Both regions at desktop and phone width, through a real browser. Prices render
from the database — BDT 499 / 899 / 1,499 and the USD equivalents.

### Not verified

Nobody has looked at these pages on a real phone. 504px was the narrowest
viewport headless Chrome would give, because Windows clamps its minimum window
width — which also produced a false "horizontal overflow" that cost an hour and
a wrong fix before a probe measured `scrollWidth === clientWidth`.

## Module 14 — a calendar you can drag, and a chart (done)

**The calendar.** Posts are tiles that move between days, keeping their time of
day; dropped onto another post, the two exchange days. Nothing saves on drop —
a prompt offers Save or Undo all, and moves go as a batch because a swap is two
moves that only make sense together. `publishing` and `published` do not lift.

**The dashboard.** A views-and-interactions line chart, per post / per week /
per month, grain in the query string. One shared axis on purpose: interactions
are a subset of views, and a second axis would make a 4% engagement rate look
like 90%.

**The figures are illustrative and the card says so.** No metrics table exists,
nothing records a view, no connection is live. Real: the buckets are the
workspace's own posts on their real dates in its own timezone, seeded from post
ids so a screenshot stays true. `readEngagement` is the only function that
changes when metrics arrive.

### Three bugs the browser driver found that reading did not

1. `details.valueAsString[0]` is locale-formatted, not ISO, so picking a date
   threw `RangeError: Invalid time value`.
2. `formatTimeInZone` returns "11:00 am"; splitting on a colon gave NaN
   minutes, so **no post chip ever rendered** — while the month grid above it
   looked perfect, which is what made it invisible.
3. An auto-scroll that appeared to work was reading the mount value. Two layout
   faults under it: `offsetTop` measured against the wrong ancestor, and the
   effect running before the rows had their new height.

All three were in code that had passed typecheck, lint and a screenshot.

### Not verified

The flip, drag and tilt of `FlipCard`, and the spotlight following a real
cursor. Headless can dispatch events but cannot move a mouse.
