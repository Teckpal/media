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
| 5 | Posts & calendar | §6.2 | todo |
| 6 | Queue & publishing | §4, §9 | todo |
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
