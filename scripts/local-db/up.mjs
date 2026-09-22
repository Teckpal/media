/**
 * Starts a throwaway Postgres for running the migrations.
 *
 * Not Supabase. There is no PostgREST, no GoTrue and no Storage here, so the
 * app cannot talk to this cluster — `supabase/local-shim.sql` only supplies the
 * handful of objects the migrations reference (`auth.users`, `auth.uid()`,
 * `storage.objects`, the three roles). What it gives us is the thing that
 * matters most: the SQL actually executing on a real Postgres, on a machine
 * with no Docker.
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR, EXE, LOG_FILE, PORT, binDir } from './config.mjs'

/**
 * `stdio` is deliberately not inherited for the start call. `pg_ctl` hands its
 * own stdout and stderr to the postgres process it leaves running, so an
 * inherited pipe stays open for as long as the server does — and the npm script
 * that invoked this never sees EOF, and never returns. The server's output goes
 * to LOG_FILE regardless.
 */
function run(exe, args, { quiet = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { stdio: quiet ? 'ignore' : 'inherit' })
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${path.basename(exe)} exited ${code}`)))
    child.on('error', reject)
  })
}

const bin = binDir()

if (!fs.existsSync(path.join(DATA_DIR, 'PG_VERSION'))) {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  const pwfile = path.join(path.dirname(DATA_DIR), 'pwfile')
  fs.writeFileSync(pwfile, 'postgres')
  console.log('initialising cluster...')
  await run(path.join(bin, `initdb${EXE}`), [
    '-D', DATA_DIR, '-U', 'postgres', `--pwfile=${pwfile}`, '-E', 'UTF8', '--locale=C',
  ])
}

fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true })

// -w waits for readiness before returning, so the next script can connect.
await run(
  path.join(bin, `pg_ctl${EXE}`),
  ['-D', DATA_DIR, '-l', LOG_FILE, '-o', `-p ${PORT}`, '-w', 'start'],
  { quiet: true },
)
console.log(`postgres listening on 127.0.0.1:${PORT}`)
