import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BD_COPY, copyFor, GLOBAL_COPY, REGION_COPY } from './copy.ts'
import { BILLING_REGIONS, PHASE_1_PLATFORMS } from '../constants.ts'

const ALL = Object.values(REGION_COPY)

test('every billing region has a landing page', () => {
  for (const region of BILLING_REGIONS) {
    assert.equal(copyFor(region).region, region, region)
  }
  assert.equal(ALL.length, BILLING_REGIONS.length)
})

test('each page is complete enough to publish', () => {
  for (const copy of ALL) {
    assert.ok(copy.metaTitle.length > 10, copy.region)
    assert.ok(copy.metaDescription.length > 50, copy.region)
    assert.ok(copy.hero.heading, copy.region)
    assert.ok(copy.hero.subheading, copy.region)
    assert.equal(copy.proofPoints.length, 3, copy.region)
    assert.ok(copy.features.length >= 4, copy.region)
    assert.ok(copy.faq.length >= 5, copy.region)
    assert.ok(copy.paymentsLine, copy.region)
  }
})

/**
 * Section 7A.3: the server reads the price from the database by region. A
 * number typed into marketing copy is a number that will still be there six
 * months after the price changed.
 */
test('no page quotes a price', () => {
  for (const copy of ALL) {
    const everything = JSON.stringify(copy)

    for (const symbol of ['৳', '$', 'BDT', 'USD', 'Tk']) {
      assert.ok(
        !everything.includes(symbol),
        `${copy.region} copy mentions ${symbol}; prices belong in the plans table`,
      )
    }

    // Nor a bare amount dressed up as one.
    assert.ok(
      !/\b\d{2,}\s*(a month|per month|\/month)/i.test(everything),
      `${copy.region} copy quotes an amount`,
    )
  }
})

/**
 * Section 11: Phase 1 is Facebook and Instagram. Naming a platform that does
 * not work yet is the cheapest possible way to lose someone's trust.
 */
test('only the platforms that work are offered', () => {
  for (const copy of ALL) {
    const everything = JSON.stringify(copy).toLowerCase()

    for (const platform of PHASE_1_PLATFORMS) {
      assert.ok(everything.includes(platform), `${copy.region} does not mention ${platform}`)
    }

    // The later platforms may be named, but only alongside a word that places
    // them in the future.
    for (const later of ['linkedin', 'youtube', 'tiktok']) {
      if (!everything.includes(later)) continue

      assert.ok(
        /planned|coming|not here yet|come next|then/.test(everything),
        `${copy.region} names ${later} without saying it is not built`,
      )
    }
  }
})

test('every call to action points somewhere inside the app', () => {
  for (const copy of ALL) {
    for (const cta of [copy.hero.primaryCta, copy.hero.secondaryCta]) {
      assert.ok(
        cta.href.startsWith('/') || cta.href.startsWith('#'),
        `${copy.region}: ${cta.href}`,
      )
      assert.ok(cta.label.length > 0, copy.region)
    }
  }
})

test('each page points at the other, and at the right one', () => {
  assert.equal(GLOBAL_COPY.otherRegion.path, BD_COPY.path)
  assert.equal(BD_COPY.otherRegion.path, GLOBAL_COPY.path)
})

// --- the regional differences that matter -----------------------------------

test('the Bangladesh page names the payment methods people actually use', () => {
  const payments = BD_COPY.paymentsLine.toLowerCase()
  for (const method of ['bkash', 'nagad', 'rocket']) {
    assert.ok(payments.includes(method), method)
  }
})

/**
 * Module 7's global gateway is a stub, because Section 13 Q6 has not been
 * answered. The Global page must not imply a checkout that does not exist.
 */
test('the global page does not promise a card checkout that is not built', () => {
  const payments = GLOBAL_COPY.paymentsLine.toLowerCase()
  assert.ok(
    payments.includes('not open') || payments.includes('talk to us'),
    'the global payments line implies self-service card payment',
  )
})

test('both pages say what happens when a payment lapses', () => {
  for (const copy of ALL) {
    const answer = copy.faq.find((item) => /stop paying/i.test(item.question))
    assert.ok(answer, copy.region)
    assert.match(answer!.answer, /stay|resume|not deleted|pauses/i)
  }
})

test('both pages are honest that removing a post leaves it live on the platform', () => {
  for (const copy of ALL) {
    const answer = copy.faq.find((item) => /delete a post/i.test(item.question))
    assert.ok(answer, copy.region)
    assert.match(answer!.answer, /stays live/i)
  }
})
