import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

/** Repo root, two levels up from `scripts/local-db`. */
export const ROOT = path.resolve(here, '..', '..')

/**
 * A port well away from 5432 and from Supabase's own 54322, so this cluster
 * cannot be mistaken for — or collide with — either one.
 */
export const PORT = 54999

export const DATA_DIR = path.join(ROOT, '.local-db', 'data')
export const LOG_FILE = path.join(ROOT, '.local-db', 'postgres.log')

export const CONNECTION = {
  host: '127.0.0.1',
  port: PORT,
  user: 'postgres',
  password: 'postgres',
  database: 'postgres',
}

export const CONNECTION_URL = `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres`

export const MIGRATIONS_DIR = path.join(ROOT, 'supabase', 'migrations')
export const SHIM_FILE = path.join(ROOT, 'supabase', 'local-shim.sql')

export const EXE = process.platform === 'win32' ? '.exe' : ''

/**
 * Where `embedded-postgres` unpacked the real Postgres binaries.
 *
 * Found by path rather than `require.resolve`, because the platform packages
 * publish an `exports` map that refuses to resolve their own `package.json`.
 */
export function binDir() {
  const candidates = [
    'windows-x64',
    'linux-x64',
    'linux-arm64',
    'darwin-arm64',
    'darwin-x64',
  ]
  for (const platform of candidates) {
    const dir = path.join(ROOT, 'node_modules', '@embedded-postgres', platform, 'native', 'bin')
    if (fs.existsSync(dir)) return dir
  }
  console.error('Could not find the embedded-postgres binaries. Run: npm install')
  process.exit(1)
}
