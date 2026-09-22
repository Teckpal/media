/** What is actually in the linked Supabase project. Reads nothing but the catalog. */
import { newClient, projectRef } from './connect.mjs'

const c = newClient()
await c.connect()

const show = async (label, sql) => {
  const { rows } = await c.query(sql)
  const values = rows.map((r) => (Object.keys(r).length === 1 ? Object.values(r)[0] : r))
  console.log(`  ${label.padEnd(24)} ${JSON.stringify(values)}`)
}

console.log(`\nproject: ${projectRef()}\n`)

await show('postgres', 'select split_part(version(), \' on \', 1) as v')
await show('connected as', 'select current_user')
await show('public tables', `select count(*)::int from information_schema.tables
  where table_schema = 'public' and table_type = 'BASE TABLE'`)
await show('public functions', `select count(*)::int from information_schema.routines
  where routine_schema = 'public'`)
await show('auth.users rows', 'select count(*)::int from auth.users')
await show('auth.users triggers', `select trigger_name from information_schema.triggers
  where event_object_schema = 'auth' and event_object_table = 'users'`)
await show('storage buckets', 'select id from storage.buckets')
await show('storage policies', `select policyname from pg_policies where schemaname = 'storage'`)
await show('schemas', `select nspname from pg_namespace
  where nspname not like 'pg_%' and nspname <> 'information_schema' order by nspname`)
await show('migration history', `select count(*)::int from information_schema.tables
  where table_schema = 'supabase_migrations' and table_name = 'schema_migrations'`)

await c.end()
