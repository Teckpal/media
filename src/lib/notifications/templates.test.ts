import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  absoluteLink,
  escapeHtml,
  isInternalPath,
  renderNotificationEmail,
} from './templates.ts'

const APP = 'https://app.motif.example'

// --- escaping ---------------------------------------------------------------

test('the five characters that break HTML are escaped', () => {
  assert.equal(escapeHtml(`<&>"'`), '&lt;&amp;&gt;&quot;&#39;')
})

test('ordinary text is left alone', () => {
  assert.equal(escapeHtml('A post about tea & biscuits'), 'A post about tea &amp; biscuits')
  assert.equal(escapeHtml('বাংলা ক্যাপশন'), 'বাংলা ক্যাপশন')
})

/**
 * The case this exists for: a notification body carries a post caption, and a
 * caption is whatever the customer typed.
 */
test('a caption containing markup cannot reach the mail client as markup', () => {
  const email = renderNotificationEmail({
    title: 'A post did not go out on Facebook',
    body: '<script>alert(1)</script> and <img src=x onerror=alert(2)>',
    appUrl: APP,
  })

  // What matters is that no *tag* can be formed. The characters of
  // "onerror=" survive as text, which is exactly what escaping is for.
  assert.ok(!email.html.includes('<script'))
  assert.ok(!email.html.includes('<img'))
  assert.ok(email.html.includes('&lt;script&gt;'))
  assert.ok(email.html.includes('&lt;img src=x onerror=alert(2)&gt;'))
})

test('a title containing markup is escaped too', () => {
  const email = renderNotificationEmail({
    title: '</h1><script>alert(1)</script>',
    appUrl: APP,
  })
  assert.ok(!email.html.includes('<script'))
  // The injected closing tag became text, so the heading still closes exactly
  // once — its own.
  assert.equal(email.html.split('</h1>').length - 1, 1)
  assert.ok(email.html.includes('&lt;/h1&gt;&lt;script&gt;'))
})

// --- links ------------------------------------------------------------------

test('a plain internal path is linked', () => {
  assert.equal(isInternalPath('/posts/abc'), true)
  assert.equal(absoluteLink(APP, '/posts/abc'), 'https://app.motif.example/posts/abc')
})

test('a trailing slash on the app URL does not double up', () => {
  assert.equal(absoluteLink('https://app.motif.example/', '/billing'), 'https://app.motif.example/billing')
})

/**
 * The one that matters: an email from our own address must never carry
 * somebody else's link.
 */
test('anything that could leave the site is refused', () => {
  for (const path of [
    'https://evil.example',
    'http://evil.example',
    '//evil.example',
    '/\\evil.example',
    'javascript:alert(1)',
    'mailto:someone@evil.example',
    'posts/abc',
    '',
    null,
    undefined,
  ]) {
    assert.equal(isInternalPath(path as string), false, String(path))
    assert.equal(absoluteLink(APP, path as string), null, String(path))
  }
})

test('a refused link leaves the email without a button rather than a broken one', () => {
  const email = renderNotificationEmail({
    title: 'Something happened',
    linkPath: 'https://evil.example',
    appUrl: APP,
  })

  assert.ok(!email.html.includes('evil.example'))
  assert.ok(!email.text.includes('evil.example'))
  assert.ok(!email.html.includes('<a href'))
})

// --- the message itself -----------------------------------------------------

test('the subject names the workspace, since a person may run several', () => {
  const email = renderNotificationEmail({
    title: 'A post did not go out',
    workspaceName: 'Cafe Dhaka',
    appUrl: APP,
  })

  assert.equal(email.subject, 'A post did not go out · Cafe Dhaka')
})

test('without a workspace the subject is just the title', () => {
  const email = renderNotificationEmail({ title: 'Your plan is active', appUrl: APP })
  assert.equal(email.subject, 'Your plan is active')
})

test('the plain-text part carries the same link as the HTML one', () => {
  const email = renderNotificationEmail({
    title: 'Your plan renews in 3 days',
    body: '৳499.00 is due.',
    linkPath: '/billing',
    appUrl: APP,
  })

  assert.ok(email.text.includes('https://app.motif.example/billing'))
  assert.ok(email.html.includes('https://app.motif.example/billing'))
  assert.ok(email.text.includes('৳499.00 is due.'))
})

test('an empty body does not leave a hole in the message', () => {
  const email = renderNotificationEmail({ title: 'Published to Facebook', body: '   ', appUrl: APP })

  assert.ok(!email.html.includes('<p style="margin:0 0 20px'))
  assert.equal(email.text.split('\n')[0], 'Published to Facebook')
})

test('every email says how to stop receiving them', () => {
  const email = renderNotificationEmail({ title: 'Published', appUrl: APP })
  assert.match(email.html, /turn these emails off in Settings/i)
})
