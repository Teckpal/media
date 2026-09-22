/** Prints the NOT NULL columns without defaults for the tables named on argv. */
import { newClient } from './connect.mjs'

const tables = process.argv.slice(2)
const c = newClient()
await c.connect()

for (const table of tables) {
  const { rows } = await c.query(
    `select column_name, data_type, udt_name, is_nullable, column_default
     from information_schema.columns
     where table_schema = 'public' and table_name = $1
     order by ordinal_position`,
    [table],
  )
  const required = rows.filter((r) => r.is_nullable === 'NO' && !r.column_default)
  console.log(`\n${table}`)
  console.log(`  required: ${required.map((r) => `${r.column_name}:${r.udt_name}`).join(', ') || '(none)'}`)
  console.log(`  all: ${rows.map((r) => r.column_name).join(', ')}`)
}

await c.end()
