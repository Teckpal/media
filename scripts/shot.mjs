/**
 * Drives a real Chrome over the DevTools Protocol to sign in and screenshot a
 * page behind the router gate.
 *
 * `--headless --screenshot` cannot click, so every authenticated screen was
 * previously unverifiable — which is how two StrictMode-only bugs reached a
 * "looks fine" report. This signs in through the actual login form, so what it
 * captures is what a signed-in person sees.
 *
 *   node scripts/shot.mjs <path> <out.png> [--w 1280] [--h 900] [--no-login]
 *                            [--click <selector>] [--eval <js>] [--as <email> <password>]
 *                            [--console] [--ws] [--reduced-motion]
 *
 * `--console` prints everything the page logged; `--ws` prints every websocket
 * frame. The second found the notification bug this was written for: the
 * realtime channel reported itself subscribed while its join frame carried no
 * access token, which is invisible from inside the page and obvious in the
 * frames.
 *
 * Credentials come from DEMO_EMAIL / DEMO_PASSWORD in .env.local.
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { ROOT, readEnv } from './remote/connect.mjs'

const args = process.argv.slice(2)

/**
 * Git Bash on Windows rewrites a leading `/` argument into a Windows path
 * before Node ever sees it, so `/calendar` arrives as something else entirely.
 * Accepting the path without its slash — and putting it back here — makes the
 * script work the same from either shell.
 */
const target = `/${(args[0] || '').replace(/^\/+/, '')}`
const out = args[1] || path.join(ROOT, '.local-db', 'shot.png')
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i > -1 ? args[i + 1] : fallback
}
const width = Number(flag('w', 1280))
const height = Number(flag('h', 900))
const noLogin = args.includes('--no-login')
const clickSelector = flag('click', null)
/** Arbitrary JS run after the page loads — for anything a CSS selector cannot reach. */
const evalScript = flag('eval', null)

const env = readEnv()
const base = env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
// `--as email password` signs in as somebody other than the demo owner, which
// is how a second member's view of a screen gets verified at all.
const email = flag('as', env.DEMO_EMAIL)
const password = args.indexOf('--as') > -1 ? args[args.indexOf('--as') + 2] : env.DEMO_PASSWORD

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find((p) => fs.existsSync(p))

if (!CHROME) {
  console.error('Chrome not found.')
  process.exit(1)
}

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'motif-shot-'))
const port = 9222 + Math.floor(Math.random() * 500)

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  `--window-size=${width},${height}`,
  '--hide-scrollbars',
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--no-first-run',
  '--disable-extensions',
  'about:blank',
], { stdio: 'ignore' })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Chrome needs a moment before the debugging endpoint answers. */
async function endpoint() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`)
      if (res.ok) return (await res.json()).webSocketDebuggerUrl
    } catch {}
    await sleep(250)
  }
  throw new Error('Chrome never opened its debugging port')
}

let nextId = 1
function connect(url) {
  const ws = new WebSocket(url)
  const pending = new Map()
  const events = []

  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data)
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.error) reject(new Error(msg.error.message))
      else resolve(msg.result)
    } else if (msg.method) {
      events.push(msg)
    }
  })

  const ready = new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', reject, { once: true })
  })

  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = nextId++
      pending.set(id, { resolve, reject })
      ws.send(JSON.stringify({ id, method, params, sessionId }))
    })

  return { ws, send, ready, events }
}

const cdp = connect(await endpoint())
await cdp.ready

const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' })
const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true })
const send = (method, params) => cdp.send(method, params, sessionId)

await send('Page.enable')
await send('Runtime.enable')

// Websocket frames, when asked for. A realtime subscription that reports
// itself connected and then delivers nothing is invisible from inside the
// page; the frames are where the server's side of that conversation is.
if (args.includes('--ws')) await send('Network.enable')

// Emulating the preference rather than trusting a comment about it. Work that
// claims to respect `prefers-reduced-motion` should be checkable, and Chrome
// will only report it if it is told to.
if (args.includes('--reduced-motion')) {
  await send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  })
}

async function goto(url) {
  await send('Page.navigate', { url })
  // Poll for the document to settle rather than trusting one lifecycle event —
  // an app-router navigation can finish after `load`.
  for (let i = 0; i < 80; i += 1) {
    await sleep(250)
    const { result } = await send('Runtime.evaluate', {
      expression: 'document.readyState === "complete" ? location.pathname : ""',
      returnByValue: true,
    })
    if (result.value) return result.value
  }
  return ''
}

async function evaluate(expression) {
  const { result } = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })
  return result.value
}

if (!noLogin) {
  if (!email || !password) {
    console.error('DEMO_EMAIL / DEMO_PASSWORD are not set in .env.local')
    process.exit(1)
  }

  await goto(`${base}/login`)

  // React listens for its own synthetic events, so setting `.value` directly is
  // invisible to it. The native setter plus a bubbled `input` is what a real
  // keystroke looks like from React's side.
  const filled = await evaluate(`(() => {
    const set = (el, value) => {
      const proto = Object.getPrototypeOf(el)
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }
    const form = document.querySelector('form')
    if (!form) return 'no form'
    const mail = form.querySelector('input[type=email], input[name=email]')
    const pass = form.querySelector('input[type=password], input[name=password]')
    if (!mail || !pass) return 'no fields'
    set(mail, ${JSON.stringify(email)})
    set(pass, ${JSON.stringify(password)})
    form.requestSubmit()
    return 'submitted'
  })()`)

  if (filled !== 'submitted') {
    console.error('could not fill the login form:', filled)
    process.exit(1)
  }

  // Wait for the gate to move us off /login.
  let landed = ''
  for (let i = 0; i < 80; i += 1) {
    await sleep(250)
    landed = await evaluate('location.pathname')
    if (landed && landed !== '/login') break
  }
  console.log(`  signed in, landed on ${landed || '(still /login)'}`)
}

const at = await goto(`${base}${target}`)
console.log(`  at ${at}`)

if (clickSelector) {
  const clicked = await evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(clickSelector)})
    if (!el) return false
    el.click()
    return true
  })()`)
  console.log(`  click ${clickSelector}: ${clicked ? 'ok' : 'not found'}`)
  await sleep(1200)
}

if (evalScript) {
  const result = await evaluate(evalScript)
  console.log('  eval:', JSON.stringify(result))
  await sleep(1200)
}

await sleep(1500)

const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(out, Buffer.from(data, 'base64'))
console.log(`  wrote ${out}`)

// Everything the page said while we were driving it. A screenshot shows what
// rendered; the console is where the things that did NOT render explain
// themselves — a failed subscription, a discarded fetch, a React warning.
if (args.includes('--ws')) {
  for (const event of cdp.events) {
    if (!event.method.startsWith('Network.webSocket')) continue
    const p = event.params
    const payload = p.response?.payloadData ?? p.request?.payloadData ?? p.url ?? ''
    console.log(`  [ws] ${event.method.replace('Network.webSocket', '')} ${String(payload).slice(0, 400)}`)
  }
}

if (args.includes('--console')) {
  for (const event of cdp.events) {
    if (event.method !== 'Runtime.consoleAPICalled') continue
    const text = event.params.args
      .map((a) => (a.value !== undefined ? String(a.value) : (a.description ?? a.type)))
      .join(' ')
    console.log(`  [${event.params.type}] ${text}`)
  }
}

cdp.ws.close()
chrome.kill()

// Chrome can still hold the profile for a moment after being killed, and a
// leftover temp directory is not worth failing a screenshot over.
try {
  fs.rmSync(profile, { recursive: true, force: true })
} catch {
  /* the OS will clear it */
}
