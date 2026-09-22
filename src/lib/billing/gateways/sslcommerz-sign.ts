// Pure apart from Node's own crypto, and imported by relative path, so the
// scheme can be tested without a store id or a network.
import { createHash } from 'node:crypto'

/**
 * SSLCommerz signs its IPN callbacks.
 *
 * The scheme, as SSLCommerz documents it: the callback carries `verify_key`,
 * a comma-separated list of the fields that were signed. Take those fields'
 * values, add `store_passwd` as the MD5 of the store password, sort by key,
 * join as `key=value&…`, and MD5 the result. It should equal `verify_sign`.
 *
 * MD5 is the gateway's choice, not ours, and it is why this signature is
 * treated as one check among several rather than as proof. The IPN handler
 * still calls the validation API afterwards — Section 7.2 says only the
 * server-to-server confirmation may mark an invoice paid, and that holds even
 * when the signature is good.
 */

const md5 = (value: string) => createHash('md5').update(value, 'utf8').digest('hex')

export function ipnHashString(
  fields: Record<string, string>,
  storePassword: string,
): string | null {
  const verifyKey = fields.verify_key
  if (!verifyKey) return null

  const signed: Record<string, string> = {}

  for (const key of verifyKey.split(',')) {
    const name = key.trim()
    if (!name) continue
    // A field named in verify_key but absent from the body signs as empty,
    // which is what the gateway's own implementation does.
    signed[name] = fields[name] ?? ''
  }

  if (Object.keys(signed).length === 0) return null

  signed.store_passwd = md5(storePassword)

  return Object.keys(signed)
    .sort()
    .map((key) => `${key}=${signed[key]}`)
    .join('&')
}

/**
 * Does the callback carry a signature we can reproduce?
 *
 * False for a missing signature, a missing key list, or a mismatch — all three
 * mean the same thing to the caller, which is that this body proves nothing.
 */
export function verifyIpnSignature(
  fields: Record<string, string>,
  storePassword: string,
): boolean {
  const presented = fields.verify_sign
  if (!presented || !storePassword) return false

  const hashString = ipnHashString(fields, storePassword)
  if (!hashString) return false

  const expected = md5(hashString)

  // Both sides are fixed-length hex from our own hashing, so a plain compare
  // leaks nothing an attacker could not compute themselves — but the constant
  // -time habit is cheap and one fewer thing to reason about later.
  if (expected.length !== presented.length) return false

  let difference = 0
  for (let i = 0; i < expected.length; i += 1) {
    difference |= expected.charCodeAt(i) ^ presented.charCodeAt(i)
  }

  return difference === 0
}
