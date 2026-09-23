import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openAccess } from './open-access.ts'

/**
 * The one thing worth asserting about a paywall bypass is that it is hard to
 * turn on by accident.
 *
 * Every value that is not exactly the string `'true'` leaves the gates in
 * place — including the ones that look like they mean yes. `OPEN_ACCESS=1` in
 * a deployment's config, or a variable left as the empty string by a template,
 * must not open the product.
 */

function withEnv(value: string | undefined, run: () => void): void {
  const before = process.env.OPEN_ACCESS
  if (value === undefined) delete process.env.OPEN_ACCESS
  else process.env.OPEN_ACCESS = value
  try {
    run()
  } finally {
    if (before === undefined) delete process.env.OPEN_ACCESS
    else process.env.OPEN_ACCESS = before
  }
}

test('unset means the gates apply', () => {
  withEnv(undefined, () => assert.equal(openAccess(), false))
})

test('only the exact string opens it', () => {
  withEnv('true', () => assert.equal(openAccess(), true))
})

test('everything that merely looks affirmative is refused', () => {
  for (const value of ['1', 'yes', 'TRUE', 'True', 'on', ' true', 'true ']) {
    withEnv(value, () =>
      assert.equal(openAccess(), false, `${JSON.stringify(value)} must not open access`),
    )
  }
})

test('an empty value is closed, not open', () => {
  // A template that writes `OPEN_ACCESS=` for an unfilled variable is the
  // likeliest way this would ever be set without anybody deciding to.
  withEnv('', () => assert.equal(openAccess(), false))
})

test('false is false', () => {
  withEnv('false', () => assert.equal(openAccess(), false))
})
