import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  dayKeyInZone,
  isPast,
  localInputToUtc,
  monthRangeUtc,
  utcToLocalInput,
} from './time.ts'

const DHAKA = 'Asia/Dhaka' // UTC+6 all year, no DST
const NEW_YORK = 'America/New_York' // UTC-5 / UTC-4
const UTC = 'UTC'

test('a wall-clock time in Dhaka becomes the right instant', () => {
  // 9am in Dhaka is 3am UTC, year round.
  const instant = localInputToUtc('2026-10-01T09:00', DHAKA)
  assert.equal(instant?.toISOString(), '2026-10-01T03:00:00.000Z')
})

test('the same wall-clock string means different instants in different zones', () => {
  // This is the whole reason the conversion is anchored to the workspace zone
  // and not the browser's: an editor travelling abroad must not shift when the
  // team's 9am post goes out.
  const dhaka = localInputToUtc('2026-10-01T09:00', DHAKA)
  const newYork = localInputToUtc('2026-10-01T09:00', NEW_YORK)

  assert.notEqual(dhaka?.toISOString(), newYork?.toISOString())
  assert.equal(newYork?.toISOString(), '2026-10-01T13:00:00.000Z')
})

test('round-trips through the input format', () => {
  for (const zone of [DHAKA, NEW_YORK, UTC]) {
    const original = '2026-07-15T14:30'
    const instant = localInputToUtc(original, zone)
    assert.ok(instant)
    assert.equal(utcToLocalInput(instant, zone), original)
  }
})

test('round-trips across a daylight-saving boundary', () => {
  // New York is UTC-4 in July and UTC-5 in January. A naive fixed-offset
  // conversion gets one of these an hour wrong.
  const summer = localInputToUtc('2026-07-15T09:00', NEW_YORK)
  const winter = localInputToUtc('2026-01-15T09:00', NEW_YORK)

  assert.equal(summer?.toISOString(), '2026-07-15T13:00:00.000Z')
  assert.equal(winter?.toISOString(), '2026-01-15T14:00:00.000Z')

  assert.equal(utcToLocalInput(summer!, NEW_YORK), '2026-07-15T09:00')
  assert.equal(utcToLocalInput(winter!, NEW_YORK), '2026-01-15T09:00')
})

test('seconds in the input are accepted', () => {
  assert.equal(
    localInputToUtc('2026-10-01T09:00:30', DHAKA)?.toISOString(),
    '2026-10-01T03:00:30.000Z',
  )
})

test('an unparseable value is null, not an Invalid Date', () => {
  for (const bad of ['', 'tomorrow', '01/10/2026 09:00', 'null', '2026-10-01 09:00']) {
    assert.equal(localInputToUtc(bad, DHAKA), null, bad)
  }
})

test('an out-of-range component is rejected rather than rolled over', () => {
  // Date arithmetic rolls silently: month 13 is January of the next year and
  // 31 February is 3 March. Either would be accepted as a valid schedule for
  // a date the user never chose.
  for (const bad of [
    '2026-13-01T09:00',
    '2026-00-01T09:00',
    '2026-10-32T09:00',
    '2026-10-00T09:00',
    '2026-10-01T24:00',
    '2026-10-01T09:60',
  ]) {
    assert.equal(localInputToUtc(bad, DHAKA), null, bad)
  }
})

test('a day that does not exist in that month is rejected', () => {
  assert.equal(localInputToUtc('2026-04-31T09:00', DHAKA), null)
  // 2026 is not a leap year.
  assert.equal(localInputToUtc('2026-02-29T09:00', DHAKA), null)
  // 2028 is.
  assert.ok(localInputToUtc('2028-02-29T09:00', DHAKA))
})

test('the calendar day is the one the workspace would name', () => {
  // 20:00 UTC on 30 September is already 1 October in Dhaka. A calendar that
  // grouped on the UTC day would file this post under the wrong square.
  const lateUtc = '2026-09-30T20:00:00.000Z'

  assert.equal(dayKeyInZone(lateUtc, UTC), '2026-09-30')
  assert.equal(dayKeyInZone(lateUtc, DHAKA), '2026-10-01')
})

test('a month range covers the zone month, not the UTC month', () => {
  // October in Dhaka starts at 18:00 UTC on 30 September.
  const { start, end } = monthRangeUtc(2026, 10, DHAKA)

  assert.equal(start.toISOString(), '2026-09-30T18:00:00.000Z')
  assert.equal(end.toISOString(), '2026-10-31T18:00:00.000Z')
})

test('a month range in UTC is the plain month', () => {
  const { start, end } = monthRangeUtc(2026, 10, UTC)

  assert.equal(start.toISOString(), '2026-10-01T00:00:00.000Z')
  assert.equal(end.toISOString(), '2026-11-01T00:00:00.000Z')
})

test('December rolls into the next year', () => {
  const { end } = monthRangeUtc(2026, 12, UTC)
  assert.equal(end.toISOString(), '2027-01-01T00:00:00.000Z')
})

test('isPast allows a minute of slack for clock skew', () => {
  const now = new Date('2026-10-01T12:00:00.000Z')

  assert.equal(isPast('2026-10-01T11:58:00.000Z', now), true)
  // Thirty seconds ago is not "in the past" — that is the round trip between
  // a person picking a time and the server storing it.
  assert.equal(isPast('2026-10-01T11:59:30.000Z', now), false)
  assert.equal(isPast('2026-10-01T12:05:00.000Z', now), false)
})
