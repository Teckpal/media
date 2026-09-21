# motif Social — build log

Source of truth for scope: `media-project-note (3).md` (v4).
Section numbers below refer to that note.

## Status

| # | Module | Note ref | Status |
|---|--------|----------|--------|
| 0 | Scaffold & wiring | §9 | done |
| 1 | Data model + RLS | §10, §6 | todo |
| 2 | Auth & router gate | §4 gate 1 | todo |
| 3 | Onboarding state machine | §5 | todo |
| 4 | Connections (FB + IG) | §6.1 | todo |
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
