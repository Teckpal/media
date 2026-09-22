import { test } from 'node:test'
import assert from 'node:assert/strict'
import { amountsMatch, decimalToMinor, minorToDecimalString } from './amounts.ts'

test('minor units become the decimal string a gateway expects', () => {
  assert.equal(minorToDecimalString(49900), '499.00')
  assert.equal(minorToDecimalString(600), '6.00')
  assert.equal(minorToDecimalString(5), '0.05')
  assert.equal(minorToDecimalString(0), '0.00')
})

test('a negative amount keeps its sign rather than becoming nonsense', () => {
  assert.equal(minorToDecimalString(-1250), '-12.50')
})

test('a gateway decimal becomes minor units exactly', () => {
  assert.equal(decimalToMinor('499.00'), 49900)
  assert.equal(decimalToMinor('6.00'), 600)
  assert.equal(decimalToMinor('0.05'), 5)
  assert.equal(decimalToMinor('12'), 1200)
})

/**
 * The case that justifies the string arithmetic: `parseFloat('1.15') * 100`
 * is 114.99999999999999, and `Math.floor` of that is a poisha short on every
 * invoice ending in 15.
 */
test('the amounts that floating point gets wrong are exact here', () => {
  assert.equal(decimalToMinor('1.15'), 115)
  assert.equal(decimalToMinor('8.29'), 829)
  assert.equal(decimalToMinor('1.005'), null) // three decimals is not money here
})

test('a single decimal place is read as tenths, not hundredths', () => {
  assert.equal(decimalToMinor('499.5'), 49950)
})

test('numbers are accepted as well as strings', () => {
  assert.equal(decimalToMinor(499), 49900)
  assert.equal(decimalToMinor(0.05), 5)
})

test('anything that is not a plain decimal is refused, not guessed at', () => {
  for (const bad of ['', '  ', 'abc', '4,999.00', '$499', '1e3', '499.001', null, undefined]) {
    assert.equal(decimalToMinor(bad as string), null, String(bad))
  }
})

test('a negative gateway amount survives the round trip', () => {
  assert.equal(decimalToMinor('-12.50'), -1250)
})

test('a round trip does not drift', () => {
  for (const minor of [0, 1, 99, 100, 49900, 123456789]) {
    assert.equal(decimalToMinor(minorToDecimalString(minor)), minor)
  }
})

// --- the comparison that guards an activation -------------------------------

test('an invoice is only matched by the exact amount', () => {
  assert.equal(amountsMatch(49900, '499.00'), true)
  assert.equal(amountsMatch(49900, '498.99'), false)
  assert.equal(amountsMatch(49900, '499.01'), false)
})

test('an unreadable amount never matches, whatever the invoice says', () => {
  assert.equal(amountsMatch(49900, 'four hundred'), false)
  assert.equal(amountsMatch(0, null), false)
  assert.equal(amountsMatch(0, undefined), false)
})

test('a zero invoice is matched by an explicit zero', () => {
  assert.equal(amountsMatch(0, '0.00'), true)
})
