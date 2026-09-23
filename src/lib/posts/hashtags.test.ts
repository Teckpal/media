import { test } from 'node:test'
import assert from 'node:assert/strict'
import { HASHTAG_NORM, hashtagBudget, suggestHashtags, toTag } from './hashtags.ts'
import { PLATFORMS } from '../constants.ts'

const PROFILE = {
  brandName: 'Motif Threads',
  industry: 'sustainable fashion',
  targetAudience: 'young professionals in Dhaka',
  keywords: ['slowfashion'],
}

const tags = (s: { tag: string }[]) => s.map((x) => x.tag)

// --- what it suggests --------------------------------------------------------

test('the brand comes before the caption', () => {
  const out = suggestHashtags({
    caption: 'Our spring collection lands this week.',
    profile: PROFILE,
  })

  const firstCaption = out.findIndex((s) => s.source === 'caption')
  const lastBrand = out.map((s) => s.source).lastIndexOf('brand')

  // Every brand tag precedes every caption tag. The account is what it is
  // about; the post is only what it is about today.
  assert.ok(lastBrand < firstCaption, JSON.stringify(out))
})

test('a typed keyword outranks an inferred one', () => {
  const out = suggestHashtags({ caption: '', profile: PROFILE })
  assert.equal(out[0].tag, 'slowfashion')
})

test('the caption supplies the topical tags', () => {
  const out = suggestHashtags({
    caption: 'Linen shirts, cut and finished in our Dhanmondi workshop.',
    profile: null,
  })

  assert.ok(tags(out).includes('linen'), JSON.stringify(tags(out)))
  assert.ok(tags(out).includes('workshop'), JSON.stringify(tags(out)))
})

test('a repeated word ranks above one mentioned once', () => {
  const out = suggestHashtags({
    caption: 'Denim. More denim. Some linen too, and denim again.',
    profile: null,
  })

  assert.equal(out[0].tag, 'denim')
})

// --- what it refuses ---------------------------------------------------------

test('a tag already in the caption is never suggested again', () => {
  const out = suggestHashtags({
    caption: 'New in: #SlowFashion linen, made slowly.',
    profile: PROFILE,
  })

  // Case differs from the profile's `slowfashion`, and it is still the same
  // tag to every platform.
  assert.ok(!tags(out).some((t) => t.toLowerCase() === 'slowfashion'), JSON.stringify(tags(out)))
})

test('filler words are not topics', () => {
  const out = suggestHashtags({
    caption: 'This is something that we think you would really want to see.',
    profile: null,
  })

  assert.deepEqual(tags(out), [])
})

test('a weekday is not a topic', () => {
  // The classic false positive: a post that says Friday is not about Fridays.
  const out = suggestHashtags({ caption: 'Back in stock on Friday.', profile: null })
  assert.ok(!tags(out).includes('friday'), JSON.stringify(tags(out)))
})

test('bare numbers are not tags', () => {
  const out = suggestHashtags({ caption: 'Only 2026 pieces made.', profile: null })
  assert.ok(!tags(out).some((t) => /^\d+$/.test(t)), JSON.stringify(tags(out)))
})

test('nothing in, nothing out', () => {
  assert.deepEqual(suggestHashtags({ caption: '', profile: null }), [])
})

// --- shaping a tag -----------------------------------------------------------

test('a phrase is camel-cased rather than run together', () => {
  // #SpringCollection reads; #springcollection does not, and they are the same
  // tag to the platform.
  assert.equal(toTag('spring collection'), 'SpringCollection')
})

test('a long phrase is cut rather than turned into a sentence', () => {
  assert.equal(toTag('young professionals in Dhaka who buy linen'), 'YoungProfessionalsInDhaka')
})

test('punctuation and spacing fall away', () => {
  assert.equal(toTag('  eco-friendly,  linen!  '), 'EcoFriendlyLinen')
})

test('a tag must start with a letter', () => {
  assert.equal(toTag('2026 collection'), null)
})

test('nothing usable gives null rather than an empty tag', () => {
  assert.equal(toTag('!!! ???'), null)
  assert.equal(toTag(''), null)
})

test('non-Latin scripts survive', () => {
  // Bangla is the home market's language; a tokenizer that dropped it would
  // silently suggest nothing for half the captions written.
  const out = suggestHashtags({ caption: 'আমাদের নতুন পোশাক এসেছে', profile: null })
  assert.ok(out.length > 0, JSON.stringify(out))
  assert.ok(out.every((s) => /^\p{L}/u.test(s.tag)))
})

// --- how many ----------------------------------------------------------------

test('the budget is the strictest platform chosen', () => {
  // One caption goes to both, so it obeys the tighter rule. Ten tags would be
  // fine on Instagram and would wreck the X version.
  assert.equal(hashtagBudget(['instagram', 'twitter']), HASHTAG_NORM.twitter)
  assert.equal(hashtagBudget(['instagram']), HASHTAG_NORM.instagram)
})

test('with nothing chosen the budget is the roomiest', () => {
  assert.equal(hashtagBudget([]), HASHTAG_NORM.instagram)
})

test('every platform has a norm', () => {
  for (const platform of PLATFORMS) {
    assert.ok(HASHTAG_NORM[platform] > 0, platform)
  }
})

test('the limit is honoured', () => {
  const out = suggestHashtags({
    caption: 'linen cotton denim wool silk cashmere leather canvas jersey poplin',
    profile: PROFILE,
    limit: 5,
  })
  assert.equal(out.length, 5)
})

test('the same input gives the same answer', () => {
  // The list must not reshuffle under the cursor while somebody reads it.
  const once = suggestHashtags({ caption: 'linen and denim and linen', profile: PROFILE })
  const twice = suggestHashtags({ caption: 'linen and denim and linen', profile: PROFILE })
  assert.deepEqual(once, twice)
})
