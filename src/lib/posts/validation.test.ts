import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  blockingIssues,
  countHashtags,
  validateForPlatform,
  validatePost,
  type MediaItem,
} from './validation.ts'

const image = (over: Partial<MediaItem> = {}): MediaItem => ({
  id: 'm1',
  mimeType: 'image/jpeg',
  width: 1080,
  height: 1080,
  ...over,
})

test('Facebook accepts a text-only post', () => {
  const issues = validateForPlatform('facebook', { caption: 'Hello', media: [] })
  assert.deepEqual(issues, [])
})

test('Instagram refuses a text-only post', () => {
  // The rule that most often bites: there is no such thing as an Instagram
  // post without a picture, and finding out at publish time is too late.
  const issues = validateForPlatform('instagram', { caption: 'Hello', media: [] })

  assert.equal(issues.length, 1)
  assert.equal(issues[0].field, 'media')
  assert.equal(issues[0].severity, 'error')
})

test('an empty post is refused even where media is optional', () => {
  const issues = validateForPlatform('facebook', { caption: '   ', media: [] })
  assert.equal(issues.length, 1)
  assert.equal(issues[0].field, 'caption')
})

test('caption length is checked per platform', () => {
  const caption = 'a'.repeat(2_500)

  assert.deepEqual(validateForPlatform('facebook', { caption, media: [] }), [])

  const ig = validateForPlatform('instagram', { caption, media: [image()] })
  assert.equal(ig.length, 1)
  assert.equal(ig[0].field, 'caption')
  assert.match(ig[0].message, /2,200 characters/)
})

test('Instagram caps hashtags at thirty', () => {
  const caption = Array.from({ length: 31 }, (_, i) => `#tag${i}`).join(' ')

  const issues = validateForPlatform('instagram', { caption, media: [image()] })
  assert.equal(issues.length, 1)
  assert.match(issues[0].message, /30 hashtags/)
})

test('counts hashtags, not hex colours or mid-word hashes', () => {
  assert.equal(countHashtags('#one #two'), 2)
  assert.equal(countHashtags('no tags here'), 0)
  assert.equal(countHashtags('#start of line'), 1)
  // "#fff" written as part of a word is not a tag someone meant.
  assert.equal(countHashtags('colour:#fff'), 0)
})

test('too many media items is an error', () => {
  const media = Array.from({ length: 11 }, (_, i) => image({ id: `m${i}` }))
  const issues = validateForPlatform('instagram', { caption: 'x', media })

  assert.ok(issues.some((i) => i.field === 'media' && /10 items/.test(i.message)))
})

test('an unsupported file type is an error', () => {
  const issues = validateForPlatform('instagram', {
    caption: 'x',
    media: [image({ mimeType: 'image/gif' })],
  })

  assert.equal(issues.length, 1)
  assert.match(issues[0].message, /image\/gif/)
})

test('a GIF is fine on Facebook', () => {
  const issues = validateForPlatform('facebook', {
    caption: 'x',
    media: [image({ mimeType: 'image/gif' })],
  })
  assert.deepEqual(issues, [])
})

test('an awkward aspect ratio warns rather than blocks', () => {
  // The platform accepts it and crops. It is the user's picture and their
  // decision, so they are told without being stopped.
  const issues = validateForPlatform('instagram', {
    caption: 'x',
    media: [image({ width: 1000, height: 3000 })],
  })

  assert.equal(issues.length, 1)
  assert.equal(issues[0].severity, 'warning')
  assert.deepEqual(blockingIssues(issues), [])
})

test('an unmeasured image is not judged on its dimensions', () => {
  // Width and height are absent until the upload has been probed. Guessing
  // would block a perfectly good picture.
  const issues = validateForPlatform('instagram', {
    caption: 'x',
    media: [image({ width: null, height: null })],
  })
  assert.deepEqual(issues, [])
})

test('an over-long video is an error on Instagram but not Facebook', () => {
  const video: MediaItem = {
    id: 'v1',
    mimeType: 'video/mp4',
    durationMs: 20 * 60 * 1000,
  }

  assert.deepEqual(validateForPlatform('facebook', { caption: 'x', media: [video] }), [])

  const ig = validateForPlatform('instagram', { caption: 'x', media: [video] })
  assert.equal(ig.length, 1)
  assert.match(ig[0].message, /15 minutes/)
})

test('validating across platforms reports each one separately', () => {
  // The case Section 6.2 is really about: one post, two platforms, and only
  // one of them is unhappy.
  const issues = validatePost(['facebook', 'instagram'], {
    caption: 'Hello',
    media: [],
  })

  assert.equal(issues.length, 1)
  assert.equal(issues[0].platform, 'instagram')
})

test('a platform listed twice is only checked once', () => {
  const issues = validatePost(['instagram', 'instagram'], { caption: 'x', media: [] })
  assert.equal(issues.length, 1)
})

test('a platform with no adapter yet reports nothing', () => {
  // Nothing can publish there, so there is nothing to validate against.
  assert.deepEqual(validateForPlatform('tiktok', { caption: '', media: [] }), [])
})
