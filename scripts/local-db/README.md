# Local database harness

Runs the migrations on a real Postgres without Docker.

`supabase start` needs Docker, which is not available on every machine this
project is built on — and while it was unavailable, 2,819 lines of SQL were
written and reviewed by reading alone. This harness closes that gap: it
downloads a real Postgres 17 as an npm dependency, applies the migrations, and
checks them.

## Use

```bash
npm run db:local          # up + migrate + verify + rules, in order
```

Or one step at a time:

| Script | Does |
|---|---|
| `npm run db:local:up` | Starts Postgres on `127.0.0.1:54999` (creates the cluster on first run) |
| `npm run db:local:migrate` | Drops the schema, applies the shim, then every migration in order |
| `npm run db:local:verify` | Checks `src/types/database.ts` against the live schema |
| `npm run db:local:rules` | Seeds data and asserts the Section 6 / 7A rules |
| `npm run db:local:down` | Stops the server |

`npm run db:local:migrate -- --keep` skips the reset and applies on top of
whatever is already there — useful when adding one migration.

The cluster lives in `.local-db/`, which is gitignored. Delete it to start over.

## What this is not

**It is not Supabase.** There is no PostgREST, no GoTrue, no Storage API and no
Realtime, so the app cannot talk to this cluster — `supabase-js` speaks to an
HTTP API that is not running here. Getting the *app* working end to end still
needs either real Supabase project credentials or Docker.

`supabase/local-shim.sql` supplies only the objects the migrations reference:
the `anon` / `authenticated` / `service_role` roles, the `extensions`, `auth`
and `storage` schemas, `auth.users`, `auth.uid()`, and `storage.objects` /
`storage.buckets`. The shim's `auth.uid()` reads the same
`request.jwt.claims` setting PostgREST sets, so RLS policies parse and plan
correctly — but nothing here proves a policy denies the right person. Only a
real Supabase project does that.

## What it does prove

That every migration executes; that the constraints, triggers and guard
functions behave as Sections 6 and 7A describe; and that the hand-written types
match the columns that actually exist.
