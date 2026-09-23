import test from 'node:test'
import assert from 'node:assert/strict'
import { safeNext } from './safe-next.ts'

const HOME = '/dashboard'

test('an ordinary in-app path is kept', () => {
  assert.equal(safeNext('/invite/abc123', HOME), '/invite/abc123')
  assert.equal(safeNext('/posts/new?draft=1', HOME), '/posts/new?draft=1')
})

test('an absolute URL to another site is refused', () => {
  assert.equal(safeNext('https://evil.example/login', HOME), HOME)
  assert.equal(safeNext('http://evil.example', HOME), HOME)
})

test('a protocol-relative URL is refused', () => {
  // The one people miss: it begins with a slash and is still another host.
  assert.equal(safeNext('//evil.example/phish', HOME), HOME)
})

test('a backslash is refused wherever it appears', () => {
  // `/\evil.example` — browsers normalise the backslash to a forward slash,
  // which turns this into `//evil.example`.
  assert.equal(safeNext('/\\evil.example', HOME), HOME)
  assert.equal(safeNext('/ok/\\evil.example', HOME), HOME)
})

test('a scheme after the slash is refused', () => {
  assert.equal(safeNext('/https:/evil.example', HOME), HOME)
  assert.equal(safeNext('/javascript:alert(1)', HOME), HOME)
})

test('control characters are refused', () => {
  assert.equal(safeNext('/ok\nSet-Cookie: a=b', HOME), HOME)
  assert.equal(safeNext('/ok\u0000', HOME), HOME)
})

test('nothing at all falls back', () => {
  assert.equal(safeNext(undefined, HOME), HOME)
  assert.equal(safeNext('', HOME), HOME)
  assert.equal(safeNext(['/a', '/b'], HOME), HOME)
})
