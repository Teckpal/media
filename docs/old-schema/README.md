# The schema that was here before

On 22 September 2026 the Supabase project `koiimpnvaxadigwiuhbk` held a
different, larger application — 46 tables, 56 functions: `tenants`, `brands`,
`listings`, `conversations`, `campaigns`, `outbox`, `ai_generations`,
`usage_ledger`. It was deployed at `motif-social.vercel.app`.

The owner chose to wipe it so this codebase could use the project. This is the
only record of what was there.

- `columns.txt` — all 46 tables with every column and type, readable.
- `openapi.json` — the raw PostgREST schema it was captured from.

**What this is not.** Structure only: no constraints, indexes, RLS policies,
functions or triggers, and no row data. It cannot rebuild that application. If
that build's own migrations exist in its repository, they are the real record
and this is only a cross-check.

Data lost was small and test-shaped: 4 tenants, 4 brands, 5 `public.users`
rows, 6 audit events, and zero posts, listings, conversations or jobs.
`auth.users` was empty, so no real account was destroyed.

Kept in `docs/` rather than `.local-db/`, which is gitignored and routinely
cleared — the previous location would have lost this on the next tidy-up.
