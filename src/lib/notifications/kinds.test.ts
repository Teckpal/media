import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CATEGORY_LABELS,
  EMAIL_PREFERENCE_COLUMN,
  NOTIFICATION_CATEGORIES,
  categoryOf,
  emailWorthy,
  minimumRoleFor,
} from './kinds.ts'
import { atLeast, ROLES } from '../constants.ts'

// --- categories -------------------------------------------------------------

test('every kind the app writes today is categorised', () => {
  // The kinds actually inserted by Modules 4, 6 and 7.
  const written: Record<string, string> = {
    post_published: 'publishing',
    post_failed: 'publishing',
    needs_reconnect: 'connections',
    payment_due: 'billing',
    payment_failed: 'billing',
    payment_succeeded: 'billing',
  }

  for (const [kind, expected] of Object.entries(written)) {
    assert.equal(categoryOf(kind), expected, kind)
  }
})

test('an unrecognised kind falls back rather than disappearing', () => {
  assert.equal(categoryOf('something_module_9_invents'), 'publishing')
})

test('every category has a label and a preference column', () => {
  for (const category of NOTIFICATION_CATEGORIES) {
    assert.ok(CATEGORY_LABELS[category].title, category)
    assert.ok(CATEGORY_LABELS[category].description, category)
    assert.ok(EMAIL_PREFERENCE_COLUMN[category], category)
  }
})

test('the preference columns are distinct', () => {
  const columns = Object.values(EMAIL_PREFERENCE_COLUMN)
  assert.equal(new Set(columns).size, columns.length)
})

// --- audience ---------------------------------------------------------------

/**
 * Section 6.3: "Admin: everything except billing and deletion." An admin who
 * cannot pay an invoice has no use for being told one is due.
 */
test('billing stops at the owner', () => {
  assert.equal(minimumRoleFor('billing'), 'owner')
  assert.equal(atLeast('admin', minimumRoleFor('billing')), false)
  assert.equal(atLeast('owner', minimumRoleFor('billing')), true)
})

test('a failed post reaches whoever can reschedule it', () => {
  assert.equal(minimumRoleFor(categoryOf('post_failed')), 'editor')
  assert.equal(atLeast('editor', 'editor'), true)
})

test('reconnecting is an admin job, so the notice is too', () => {
  assert.equal(minimumRoleFor(categoryOf('needs_reconnect')), 'admin')
  assert.equal(atLeast('editor', minimumRoleFor('connections')), false)
})

test('a viewer is never the audience for anything', () => {
  for (const category of NOTIFICATION_CATEGORIES) {
    assert.equal(atLeast('viewer', minimumRoleFor(category)), false, category)
  }
})

test('every minimum role is a real role', () => {
  for (const category of NOTIFICATION_CATEGORIES) {
    assert.ok(ROLES.includes(minimumRoleFor(category)), category)
  }
})

// --- what gets emailed ------------------------------------------------------

test('a successful post is shown in the app and not emailed', () => {
  assert.equal(emailWorthy('post_published'), false)
})

test('everything that needs somebody to act is emailed', () => {
  for (const kind of [
    'post_failed',
    'needs_reconnect',
    'payment_due',
    'payment_failed',
    'payment_succeeded',
  ]) {
    assert.equal(emailWorthy(kind), true, kind)
  }
})
