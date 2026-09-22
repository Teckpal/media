/**
 * Checks `src/types/database.ts` against the schema the migrations just built.
 *
 * `supabase gen types` needs Docker, which is the whole reason this harness
 * exists — so instead of regenerating the file, this reads it and reports where
 * it disagrees with the database: missing columns, columns that no longer
 * exist, nullability that does not match, and enum members that have drifted.
 */
import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'
import { CONNECTION, ROOT } from './config.mjs'

const src = fs.readFileSync(path.join(ROOT, 'src', 'types', 'database.ts'), 'utf8')

let issues = 0
const report = (scope, message) => {
  issues++
  console.log(`  ${scope}: ${message}`)
}

/** Reads a `export type X = { ... }` block, following `Base & { ... }`. */
function parseRow(typeName, seen = new Set()) {
  if (seen.has(typeName)) return {}
  seen.add(typeName)

  const header = `export type ${typeName} = `
  const at = src.indexOf(header)
  if (at < 0) return null

  const brace = src.indexOf('{', at)
  const between = src.slice(at + header.length, brace)

  let base = {}
  const amp = between.indexOf('&')
  if (amp > -1) {
    const baseName = between.slice(0, amp).trim()
    if (/^[A-Za-z_]\w*$/.test(baseName)) base = parseRow(baseName, seen) || {}
  }

  let depth = 0
  let end = brace
  for (; end < src.length; end++) {
    if (src[end] === '{') depth++
    else if (src[end] === '}' && --depth === 0) break
  }

  const cols = {}
  for (const line of src.slice(brace + 1, end).split('\n')) {
    const m = line.match(/^\s*(\w+)(\?)?:\s*(.+?)\s*$/)
    if (!m) continue
    const ts = m[3].replace(/\/\/.*$/, '').trim()
    cols[m[1]] = { ts, nullable: /\|\s*null\b/.test(ts) }
  }
  return { ...base, ...cols }
}

/** Postgres type -> the TypeScript type the generator would emit. */
const FAMILY = {
  uuid: 'string', text: 'string', citext: 'string', varchar: 'string', bpchar: 'string',
  int2: 'number', int4: 'number', int8: 'number', numeric: 'number', float4: 'number', float8: 'number',
  bool: 'boolean', jsonb: 'Json', json: 'Json',
  timestamptz: 'string', timestamp: 'string', date: 'string', time: 'string', interval: 'string',
  bytea: 'string', inet: 'string',
}

function expectedTs(udt, enumNames) {
  if (udt.startsWith('_')) {
    const inner = expectedTs(udt.slice(1), enumNames)
    return inner ? `${inner}[]` : null
  }
  return enumNames[udt] || FAMILY[udt] || null
}

const client = new pg.Client(CONNECTION)
await client.connect()

// --- enums ------------------------------------------------------------------
const tsEnumNames = [...src.matchAll(/export type (\w+Enum) =/g)].map((m) => m[1])
const tsEnumMembers = {}
for (const m of src.matchAll(/export type (\w+Enum) =([\s\S]*?)(?=\nexport |\n\/\*\*|\n\/\/)/g)) {
  tsEnumMembers[m[1]] = [...m[2].matchAll(/'([^']+)'/g)].map((x) => x[1])
}

const { rows: enumRows } = await client.query(`
  select t.typname, array_agg(e.enumlabel::text order by e.enumsortorder) as labels
  from pg_type t join pg_enum e on e.enumtypid = t.oid
  where t.typnamespace = 'public'::regnamespace
  group by t.typname order by t.typname`)

/** pg enum type name -> TS enum type name, matched by PascalCase + "Enum". */
const enumNames = {}
for (const { typname, labels } of enumRows) {
  const pascal = typname.split('_').map((s) => s[0].toUpperCase() + s.slice(1)).join('') + 'Enum'
  const tsName = tsEnumNames.find((n) => n.toLowerCase() === pascal.toLowerCase())
  if (!tsName) {
    report('enums', `pg enum "${typname}" has no TypeScript counterpart`)
    continue
  }
  enumNames[typname] = tsName

  const ts = tsEnumMembers[tsName] || []
  const missing = labels.filter((v) => !ts.includes(v))
  const extra = ts.filter((v) => !labels.includes(v))
  if (missing.length) report('enums', `${tsName}: in DB but not in TS — ${missing.join(', ')}`)
  if (extra.length) report('enums', `${tsName}: in TS but not in DB — ${extra.join(', ')}`)
}

// --- tables and columns -----------------------------------------------------
const tablesBlock = src.slice(src.indexOf('export type Database'))
const tableMap = {}
for (const m of tablesBlock.matchAll(/^\s{6}(\w+):\s*Table<\s*(\w+)/gm)) tableMap[m[1]] = m[2]

const { rows } = await client.query(`
  select table_name, column_name, udt_name, is_nullable
  from information_schema.columns
  where table_schema = 'public'
  order by table_name, ordinal_position`)

const byTable = {}
for (const r of rows) (byTable[r.table_name] ||= []).push(r)

for (const [table, cols] of Object.entries(byTable)) {
  const tsName = tableMap[table]
  if (!tsName) {
    report(table, 'no entry in Database.public.Tables')
    continue
  }
  const ts = parseRow(tsName)
  if (!ts) {
    report(table, `TypeScript type ${tsName} not found`)
    continue
  }

  for (const col of cols) {
    const field = ts[col.column_name]
    if (!field) {
      report(table, `column "${col.column_name}" (${col.udt_name}) is missing from ${tsName}`)
      continue
    }
    const nullable = col.is_nullable === 'YES'
    if (nullable && !field.nullable) report(table, `"${col.column_name}" is nullable in the DB but not "| null" in TS`)
    if (!nullable && field.nullable) report(table, `"${col.column_name}" is NOT NULL in the DB but "| null" in TS`)

    const want = expectedTs(col.udt_name, enumNames)
    if (want) {
      const got = field.ts.replace(/\s*\|\s*null/g, '').trim()
      const jsonish = want === 'Json' && /Json|Record|\{/.test(got)
      const literal = want === 'string' && got.startsWith("'")
      if (got !== want && !jsonish && !literal) {
        report(table, `"${col.column_name}" is ${col.udt_name} -> expected ${want}, TS has ${got}`)
      }
    }
  }

  for (const name of Object.keys(ts)) {
    if (!cols.some((c) => c.column_name === name)) report(table, `TS declares "${name}" but no such column exists`)
  }
}

for (const table of Object.keys(tableMap)) {
  if (!byTable[table]) report(table, 'declared in Database.public.Tables but the table does not exist')
}

console.log(`\n${Object.keys(byTable).length} tables, ${enumRows.length} enums checked — ${issues} issue(s)`)
await client.end()
process.exit(issues ? 1 : 0)
