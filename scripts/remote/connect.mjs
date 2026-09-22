/**
 * A direct Postgres connection to the Supabase project in `.env.local`.
 *
 * Used for the things the REST API cannot do — creating the schema, reading the
 * catalog — and by nothing the app runs. New Supabase projects no longer expose
 * `db.<ref>.supabase.co`, so this goes through the session-mode pooler on 5432;
 * transaction mode (6543) would break the multi-statement migration files.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

export function readEnv() {
  const env = {}
  for (const line of fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m) env[m[1]] = m[2].replace(/^"(.*)"$/, '$1')
  }
  return env
}

export function projectRef(env = readEnv()) {
  const m = (env.NEXT_PUBLIC_SUPABASE_URL || '').match(/https:\/\/([^.]+)\./)
  if (!m) throw new Error('NEXT_PUBLIC_SUPABASE_URL is not a Supabase project URL')
  return m[1]
}

export function newClient() {
  const env = readEnv()
  const ref = projectRef(env)

  if (!env.SUPABASE_DB_PASSWORD) {
    throw new Error('SUPABASE_DB_PASSWORD is not set in .env.local')
  }

  return new pg.Client({
    host: env.SUPABASE_DB_HOST || `db.${ref}.supabase.co`,
    port: Number(env.SUPABASE_DB_PORT || 5432),
    user: env.SUPABASE_DB_HOST?.includes('pooler') ? `postgres.${ref}` : 'postgres',
    password: env.SUPABASE_DB_PASSWORD,
    database: 'postgres',
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 20_000,
    statement_timeout: 180_000,
  })
}
