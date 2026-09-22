import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MAX_CAROUSEL_ITEMS, planMetaPublish, type PlanMedia } from './meta-plan.ts'

const image = (id: string): PlanMedia => ({
  id,
  mimeType: 'image/jpeg',
  url: `https://signed.example/${id}`,
})

const video = (id: string): PlanMedia => ({
  id,
  mimeType: 'video/mp4',
  url: `https://signed.example/${id}`,
})

function plan(platform: 'facebook' | 'instagram', caption: string, media: PlanMedia[]) {
  return planMetaPublish(platform, { caption, media })
}

// --- Facebook ---------------------------------------------------------------

test('Facebook publishes text on its own', () => {
  const result = plan('facebook', 'Hello', [])
  assert.equal(result.ok, true)
  assert.equal(result.ok && result.plan.kind, 'facebook_text')
})

test('Facebook refuses a post with neither text nor media', () => {
  const result = plan('facebook', '   ', [])
  assert.equal(result.ok, false)
})

test('one photo uses the photos endpoint, several use an attached feed post', () => {
  const single = plan('facebook', 'One', [image('a')])
  assert.equal(single.ok && single.plan.kind, 'facebook_photo')

  const many = plan('facebook', 'Three', [image('a'), image('b'), image('c')])
  assert.equal(many.ok && many.plan.kind, 'facebook_multi_photo')
  assert.equal(many.ok && many.plan.kind === 'facebook_multi_photo' && many.plan.photos.length, 3)
})

test('a video is its own kind of Facebook post', () => {
  const result = plan('facebook', 'Clip', [video('v')])
  assert.equal(result.ok && result.plan.kind, 'facebook_video')
})

test('Facebook refuses a video mixed with photos rather than dropping either', () => {
  const result = plan('facebook', 'Both', [video('v'), image('a')])
  assert.equal(result.ok, false)
  assert.match(!result.ok ? result.reason : '', /video and photos/i)
})

test('Facebook refuses two videos in one post', () => {
  const result = plan('facebook', 'Two', [video('v1'), video('v2')])
  assert.equal(result.ok, false)
})

// --- Instagram --------------------------------------------------------------

test('Instagram refuses a text-only post', () => {
  const result = plan('instagram', 'Just words', [])
  assert.equal(result.ok, false)
  assert.match(!result.ok ? result.reason : '', /without an image or video/i)
})

test('a lone still is an image post, a lone clip is a video post', () => {
  assert.equal(plan('instagram', '', [image('a')]).ok, true)
  const still = plan('instagram', '', [image('a')])
  assert.equal(still.ok && still.plan.kind, 'instagram_image')

  const clip = plan('instagram', '', [video('v')])
  assert.equal(clip.ok && clip.plan.kind, 'instagram_video')
})

test('several files become a carousel, in the order given', () => {
  const result = plan('instagram', 'Trip', [image('a'), video('v'), image('b')])
  assert.equal(result.ok && result.plan.kind, 'instagram_carousel')
  assert.deepEqual(
    result.ok && result.plan.kind === 'instagram_carousel'
      ? result.plan.items.map((i) => i.id)
      : [],
    ['a', 'v', 'b'],
  )
})

// --- shared limits ----------------------------------------------------------

test('both platforms stop at the carousel limit', () => {
  const eleven = Array.from({ length: MAX_CAROUSEL_ITEMS + 1 }, (_, i) => image(`m${i}`))

  for (const platform of ['facebook', 'instagram'] as const) {
    const result = plan(platform, 'Too many', eleven)
    assert.equal(result.ok, false, platform)
    assert.match(!result.ok ? result.reason : '', /at most 10/i)
  }
})

test('exactly the limit is still allowed', () => {
  const ten = Array.from({ length: MAX_CAROUSEL_ITEMS }, (_, i) => image(`m${i}`))
  assert.equal(plan('instagram', 'Ten', ten).ok, true)
  assert.equal(plan('facebook', 'Ten', ten).ok, true)
})

test('a file type neither platform posts is refused by name', () => {
  const pdf: PlanMedia = { id: 'p', mimeType: 'application/pdf', url: 'https://x' }
  const result = plan('facebook', 'Report', [pdf])
  assert.equal(result.ok, false)
  assert.match(!result.ok ? result.reason : '', /application\/pdf/)
})

test('a platform with no publishing wired is refused, not attempted', () => {
  const result = planMetaPublish('tiktok', { caption: 'hi', media: [image('a')] })
  assert.equal(result.ok, false)
})
