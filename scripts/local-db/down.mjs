import { spawn } from 'node:child_process'
import path from 'node:path'
import { DATA_DIR, EXE, binDir } from './config.mjs'

const child = spawn(path.join(binDir(), `pg_ctl${EXE}`), ['-D', DATA_DIR, '-m', 'fast', 'stop'], {
  stdio: 'inherit',
})
child.on('exit', (code) => process.exit(code ?? 0))
