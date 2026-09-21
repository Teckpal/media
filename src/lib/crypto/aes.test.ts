import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import {
  accountTokenContext,
  decryptWithKey,
  encryptWithKey,
  safeEqual,
  VERSION,
} from './aes.ts'

const KEY = randomBytes(32)
const OTHER_KEY = randomBytes(32)

test('round-trips a token', () => {
  const secret = 'EAAG...a-long-page-access-token'
  assert.equal(decryptWithKey(KEY, encryptWithKey(KEY, secret)), secret)
})

test('round-trips unicode and empty strings', () => {
  for (const value of ['', 'বাংলা টোকেন', '🔐'.repeat(50)]) {
    assert.equal(decryptWithKey(KEY, encryptWithKey(KEY, value)), value)
  }
})

test('two encryptions of the same value differ', () => {
  // A fresh IV each time, so identical tokens are not identifiable as such
  // from the ciphertext alone.
  const a = encryptWithKey(KEY, 'same')
  const b = encryptWithKey(KEY, 'same')
  assert.notEqual(a, b)
})

test('payload carries its version', () => {
  assert.ok(encryptWithKey(KEY, 'x').startsWith(`${VERSION}.`))
})

test('a different key cannot decrypt', () => {
  const payload = encryptWithKey(KEY, 'secret')
  assert.throws(() => decryptWithKey(OTHER_KEY, payload))
})

test('tampering with the ciphertext is detected', () => {
  const [v, iv, ct, tag] = encryptWithKey(KEY, 'secret').split('.')
  const flipped = Buffer.from(ct, 'base64url')
  flipped[0] ^= 0xff
  assert.throws(() =>
    decryptWithKey(KEY, [v, iv, flipped.toString('base64url'), tag].join('.')),
  )
})

test('tampering with the auth tag is detected', () => {
  const [v, iv, ct, tag] = encryptWithKey(KEY, 'secret').split('.')
  const flipped = Buffer.from(tag, 'base64url')
  flipped[0] ^= 0xff
  assert.throws(() =>
    decryptWithKey(KEY, [v, iv, ct, flipped.toString('base64url')].join('.')),
  )
})

test('a malformed payload is rejected, not silently accepted', () => {
  assert.throws(() => decryptWithKey(KEY, 'nonsense'))
  assert.throws(() => decryptWithKey(KEY, 'v1.only.three'))
})

test('an unknown version is refused', () => {
  const [, iv, ct, tag] = encryptWithKey(KEY, 'secret').split('.')
  assert.throws(
    () => decryptWithKey(KEY, ['v9', iv, ct, tag].join('.')),
    /Unsupported encryption version/,
  )
})

test('a key of the wrong length is refused', () => {
  assert.throws(() => encryptWithKey(randomBytes(16), 'x'), /must be 32 bytes/)
})

// This is the property that matters for Section 6.1: a token belongs to one
// connection, and moving a row's ciphertext to another connection must fail
// rather than quietly publish to the wrong page.
test('context binds a token to one account', () => {
  const mine = accountTokenContext('ws-1', 'facebook', 'page-1')
  const theirs = accountTokenContext('ws-2', 'facebook', 'page-1')

  const payload = encryptWithKey(KEY, 'page-token', mine)

  assert.equal(decryptWithKey(KEY, payload, mine), 'page-token')
  assert.throws(() => decryptWithKey(KEY, payload, theirs))
  assert.throws(() => decryptWithKey(KEY, payload))
})

test('context is part of the identity, not an afterthought', () => {
  assert.equal(
    accountTokenContext('ws', 'instagram', '123'),
    'social_account:ws:instagram:123',
  )
  assert.notEqual(
    accountTokenContext('ws', 'facebook', '123'),
    accountTokenContext('ws', 'instagram', '123'),
  )
})

test('safeEqual compares by value and rejects length mismatches', () => {
  assert.equal(safeEqual('abc', 'abc'), true)
  assert.equal(safeEqual('abc', 'abd'), false)
  assert.equal(safeEqual('abc', 'abcd'), false)
  assert.equal(safeEqual('', ''), true)
})
