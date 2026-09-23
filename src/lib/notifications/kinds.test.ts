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
  // The kinds actually inserted somewhere in the codebase. Kept in step by
  // hand, because the alternative — deriving it — would only prove the map
  // agrees with itself. A kind added without a category silently becomes
  // 'publishing' and is emailed to editors, which is how the wrong people
  // start being told about the wrong things.
  const written: Record<string, string> = {
    post_published: 'publishing',
    post_failed: 'publishing',
    post_scheduled: 'publishing',
    post_publishing: 'publishing',
    post_rescheduled: 'publishing',
    post_cancelled: 'publishing',
    post_removed: 'publishing',
    post_deleted: 'publishing',
    approval_requested: 'team',
    needs_reconnect: 'connections',
    account_connected: 'connections',
    account_disconnected: 'connections',
    payment_due: 'billing',
    payment_failed: 'billing',
    payment_succeeded: 'billing',
    member_invited: 'team',
    member_joined: 'team',
    member_removed: 'team',
    member_role_changed: 'team',
    invite_revoked: 'team',
  }

  for (const [kind, expected] of Object.entries(written)) {
    assert.equal(categoryOf(kind), expected, kind)
  }
})

/**
 * The bell shows everything; only email is filtered by role.
 *
 * Worth stating as a test, because `minimumRoleFor` reads like an access
 * control and is not one — `notifications_select_own` gives every member of a
 * workspace every unaddressed notification in it. An editor sees "Rina is now
 * admin" in the panel and is not emailed about it, and that is the design:
 * Section 6.3 splits work across people, and people cannot coordinate around
 * changes they are not shown.
 */
test('team changes are in-app for everyone and emailed only to admins', () => {
  for (const kind of ['member_invited', 'member_joined', 'member_role_changed']) {
    assert.equal(categoryOf(kind), 'team', kind)
  }
  assert.equal(minimumRoleFor('team'), 'admin')
})

test('routine confirmations are shown but not emailed', () => {
  assert.equal(emailWorthy('post_published'), false)
  assert.equal(emailWorthy('account_connected'), false)
  assert.equal(emailWorthy('invite_revoked'), false)
  assert.equal(emailWorthy('post_scheduled'), false)
  assert.equal(emailWorthy('post_cancelled'), false)
  assert.equal(emailWorthy('post_rescheduled'), false)

  // The ones that are somebody needing to act, or to know.
  assert.equal(emailWorthy('post_failed'), true)
  assert.equal(emailWorthy('member_removed'), true)
  assert.equal(emailWorthy('account_disconnected'), true)
  // A draft deleted for good, and a post waiting on somebody, are both worth
  // an interruption: one cannot be undone and the other blocks the calendar.
  assert.equal(emailWorthy('post_deleted'), true)
  assert.equal(emailWorthy('approval_requested'), true)
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
