/**
 * Applies the shim and then every migration, in filename order, on a clean
 * schema. Stops at the first failure and names the line.
 *
 * `--keep` skips the reset, so a migration can be re-applied on top of data
 * that is already there.
 */
import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'
import { CONNECTION, MIGRATIONS_DIR, SHIM_FILE } from './config.mjs'

const keep = process.argv.includes('--keep')

const client = new pg.Client(CONNECTION)
await client.connect()

if (!keep) {
  await client.query(`
    drop schema if exists public cascade;
    create schema public;
    drop schema if exists auth cascade;
    drop schema if exists storage cascade;
    drop schema if exists extensions cascade;
  `)
  // Roles are cluster-wide, so they survive a schema drop.
  for (const role of ['anon', 'authenticated', 'service_role']) {
    await client.query(`drop role if exists ${role}`)
  }
}

const files = [['local-shim.sql', fs.readFileSync(SHIM_FILE, 'utf8')]]
for (const name of fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
  files.push([name, fs.readFileSync(path.join(MIGRATIONS_DIR, name), 'utf8')])
}

let failed = false
for (const [name, sql] of files) {
  try {
    await client.query(sql)
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

await client.end()
process.exit(failed ? 1 : 0)
