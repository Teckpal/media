import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { ipnHashString, verifyIpnSignature } from './sslcommerz-sign.ts'

const STORE_PASSWORD = 'testpass@ssl'
const md5 = (value: string) => createHash('md5').update(value, 'utf8').digest('hex')

/** A callback body, signed the way the gateway would sign it. */
function signed(extra: Record<string, string> = {}): Record<string, string> {
  const fields: Record<string, string> = {
    tran_id: 'motif-0001',
    val_id: '2609221200000000',
    amount: '499.00',
    currency: 'BDT',
    status: 'VALID',
    verify_key: 'amount,currency,status,tran_id,val_id',
    ...extra,
  }

  fields.verify_sign = md5(ipnHashString(fields, STORE_PASSWORD)!)
  return fields
}

test('the hash string is sorted, joined and carries the hashed password', () => {
  const hashString = ipnHashString(
    {
      tran_id: 'motif-0001',
      amount: '499.00',
      verify_key: 'tran_id,amount',
    },
    STORE_PASSWORD,
  )

  assert.equal(
    hashString,
    `amount=499.00&store_passwd=${md5(STORE_PASSWORD)}&tran_id=motif-0001`,
  )
})

test('a field named in verify_key but missing from the body signs as empty', () => {
  const hashString = ipnHashString(
    { tran_id: 'motif-0001', verify_key: 'tran_id,card_type' },
    STORE_PASSWORD,
  )
  assert.match(hashString!, /card_type=&/)
})

test('a properly signed callback verifies', () => {
  assert.equal(verifyIpnSignature(signed(), STORE_PASSWORD), true)
})

test('changing the amount after signing breaks the signature', () => {
  const fields = signed()
  fields.amount = '1.00'
  assert.equal(verifyIpnSignature(fields, STORE_PASSWORD), false)
})

test('changing the status after signing breaks the signature', () => {
  const fields = signed()
  fields.status = 'VALID'
  fields.tran_id = 'someone-elses-invoice'
  assert.equal(verifyIpnSignature(fields, STORE_PASSWORD), false)
})

test('the wrong store password does not verify', () => {
  assert.equal(verifyIpnSignature(signed(), 'not-the-password'), false)
})

test('a body with no signature proves nothing', () => {
  const fields = signed()
  delete fields.verify_sign
  assert.equal(verifyIpnSignature(fields, STORE_PASSWORD), false)
})

test('a body with no verify_key proves nothing', () => {
  const fields = signed()
  delete fields.verify_key
  assert.equal(verifyIpnSignature(fields, STORE_PASSWORD), false)
})

test('an empty store password refuses rather than hashing nothing', () => {
  assert.equal(verifyIpnSignature(signed(), ''), false)
})

test('a signature of the wrong length is refused without comparing', () => {
  const fields = signed()
  fields.verify_sign = 'short'
  assert.equal(verifyIpnSignature(fields, STORE_PASSWORD), false)
})

test('extra unsigned fields do not affect the signature', () => {
  // Only what `verify_key` names is signed, so a gateway adding a field later
  // must not start failing every callback.
  const fields = signed()
  fields.risk_level = '0'
  assert.equal(verifyIpnSignature(fields, STORE_PASSWORD), true)
})
