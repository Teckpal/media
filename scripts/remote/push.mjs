/**
 * Applies `supabase/migrations` to the linked Supabase project.
 *
 * `--wipe` first drops and rebuilds the `public` schema. That is destructive and
 * irreversible, so it is never the default.
 *
 * Why not `supabase db push`: that needs a Supabase access token to link, and
 * this only needs the database password, which is what we have. It also lets us
 * set the default privileges below before any table is created, which matters
 * more than it sounds — see the comment on `SCHEMA_SETUP`.
 */
import fs from 'node:fs'
import path from 'node:path'
import { ROOT, newClient, projectRef } from './connect.mjs'

const wipe = process.argv.includes('--wipe')
const MIGRATIONS = path.join(ROOT, 'supabase', 'migrations')

/**
 * A `public` schema shaped the way Supabase shapes one.
 *
 * The default privileges are the part that is easy to miss. None of the
 * migrations grants table privileges to `anon` or `authenticated` — migration
 * 0008 only ever *revokes* a table-wide SELECT and grants specific columns
 * back, which assumes the grant was already there. On Supabase that assumption
 * holds because of a default ACL, and if the default ACL is missing, every
 * table lands unreadable by the app and RLS never even gets a say.
 *
 * So these run before the first `create table`, and 0008's revokes still land
 * last and stick.
 */
const SCHEMA_SETUP = `
  create schema if not exists public;
  alter schema public owner to pg_database_owner;

  grant usage on schema public to public;
  grant usage on schema public to postgres, anon, authenticated, service_role;
  grant create on schema public to postgres;

  alter default privileges for role postgres in schema public
    grant all on tables to postgres, anon, authenticated, service_role;
  alter default privileges for role postgres in schema public
    grant all on sequences to postgres, anon, authenticated, service_role;
  alter default privileges for role postgres in schema public
    grant execute on functions to postgres, anon, authenticated, service_role;
`

const client = newClient()
await client.connect()

console.log(`\nproject: ${projectRef()}`)

if (wipe) {
  const { rows } = await client.query(`select count(*)::int as n from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE'`)
  console.log(`\n  dropping public schema (${rows[0].n} tables)...`)
  await client.query('drop schema if exists public cascade')
  await client.query(SCHEMA_SETUP)
  console.log('  public schema rebuilt with Supabase default privileges')

  // Old migration history would make a later `supabase db push` think our
  // migrations had already run.
  await client.query(`create schema if not exists supabase_migrations`)
  await client.query(`create table if not exists supabase_migrations.schema_migrations (
    version text primary key, statements text[], name text)`)
  const { rowCount } = await client.query('delete from supabase_migrations.schema_migrations')
  console.log(`  cleared ${rowCount} old migration history row(s)`)
} else {
  console.log('\n  (no --wipe: applying on top of what is there)')
}

// Without --wipe the history is what says which migrations have already run.
// Writing it but never reading it made a second push re-apply migration 0001
// and fail on "type platform already exists" — the table was a record nobody
// consulted.
await client.query(`create schema if not exists supabase_migrations`)
await client.query(`create table if not exists supabase_migrations.schema_migrations (
  version text primary key, statements text[], name text)`)

const { rows: history } = await client.query(
  'select version from supabase_migrations.schema_migrations',
)
const applied = new Set(history.map((row) => row.version))

console.log('')

const files = fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()
let failed = false
let skipped = 0

for (const name of files) {
  const sql = fs.readFileSync(path.join(MIGRATIONS, name), 'utf8')
  const version = name.split('_')[0]

  if (applied.has(version)) {
    skipped += 1
    continue
  }

  try {
    await client.query(sql)
    await client.query(
      `insert into supabase_migrations.schema_migrations (version, name)
       values ($1, $2) on conflict (version) do nothing`,
      [version, name.replace(/^\d+_/, '').replace(/\.sql$/, '')])
    console.log(`  ok    ${name}`)
  } catch (error) {
    failed = true
    console.log(`  FAIL  ${name}`)
    console.log(`        ${error.message}`)
    if (error.position) {
      const line = sql.slice(0, Number(error.position)).split('\n').length
      console.log(`        line ${line}: ${sql.split('\n')[line - 1].trim()}`)
    }
    if (error.detail) console.log(`        detail: ${error.detail}`)
    if (error.hint) console.log(`        hint:   ${error.hint}`)
    break
  }
}

if (skipped > 0) console.log(`
  ${skipped} already applied, skipped`)

await client.end()
process.exit(failed ? 1 : 0)
