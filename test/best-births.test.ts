import test from 'node:test';
import assert from 'node:assert/strict';
import { bestBirths } from '../src/sky.js';
import { wallClock } from '../src/best-births.js';
import { localDateTimeToUtc } from '../src/calendar.js';
import type { BestBirthsRequest } from '../src/sky.js';
import { BIRTH_PLACES } from '../src/birth-places.js';

// A small search keeps the test quick: two places per region, a few birth days, hourly instants.
const places = ['tokyo', 'delhi', 'london', 'rome', 'cairo', 'lagos', 'new-york', 'sao-paulo', 'sydney', 'auckland']
  .map(id => BIRTH_PLACES.find(p => p.id === id)!);
const houseRank = [2, 2, 6, 3, 6, 5, 4, 0, 4, 5, 6, 0];
const request: BestBirthsRequest = { date: '2026-10-23', timezone: 'Asia/Tokyo', minAge: 10, maxAge: 100, places, houseRank,
  perRegion: 1, depth: 40, stepMinutes: 60 };

test('the chosen births make no square or opposition with the day\'s Moon, and are spread out', () => {
  const result = bestBirths(request);
  assert.ok(result.ok);
  const { births, today } = result.value;
  assert.equal(births.length, 5);
  assert.equal(today.longitudes.length, 10);
  assert.deepEqual(births.map(b => b.rank), [1, 2, 3, 4, 5]);
  assert.deepEqual(result.value.shortfall, {});
  assert.deepEqual(births.map(b => b.crowned), [true, true, true, false, false]);
  assert.deepEqual(new Set(births.map(b => b.region)), new Set(['asia', 'europe', 'africa', 'americas', 'oceania']));
  const days = births.map(b => Date.parse(`${b.date}T00:00:00Z`) / 86_400_000);
  for (const [i, birth] of births.entries()) {
    // Read again with the daily calculation: no hard aspect, at least one trine, the counts as scored.
    assert.ok(birth.perfections.length > 0, birth.date);
    assert.ok(birth.perfections.every(p => p.aspect !== 'square' && p.aspect !== 'opposition'), birth.date);
    assert.equal(birth.perfections.filter(p => p.aspect === 'trine').length, birth.score.trines, birth.date);
    assert.equal(birth.perfections.length - birth.score.trines, birth.score.other, birth.date);
    assert.ok(birth.age >= 10 && birth.age <= 100, `${birth.age}`);
    assert.equal(birth.natal.longitudes.length, 10);
    // The date, time and offset name the very instant that was searched.
    const place = places.find(p => p.id === birth.placeId)!;
    assert.equal(localDateTimeToUtc(birth.date, birth.time, place.timezone, birth.utcOffsetMinutes).toISOString(), birth.instant);
    for (let j = 0; j < i; j++) assert.ok(Math.abs(days[i] - days[j]) >= 7, `${births[i].date} ${births[j].date}`);
  }
  // Best first: the house rank never rises down the list.
  for (let i = 1; i < births.length; i++) assert.ok(births[i].score.house <= births[i - 1].score.house);
});

test('an impossible request is an input error', () => {
  for (const wrong of [{ minAge: 50, maxAge: 40 }, { maxAge: 130 }, { stepMinutes: 0 }, { stepMinutes: 1.5 }, { depth: 0 }, { spreadDays: -1 }, { crowns: Infinity }]) {
    assert.equal(bestBirths({ ...request, ...wrong }).ok, false, JSON.stringify(wrong));
  }
  assert.equal(bestBirths({ ...request, places: [{ ...request.places[0], latitude: 80 }] }).ok, false);
});

test('a region with too few places reports how many births it is missing', () => {
  const result = bestBirths({ ...request, places: [places[0]], perRegion: 2, depth: 10 });
  assert.ok(result.ok);
  assert.equal(result.value.births.length, 1);
  assert.deepEqual(result.value.shortfall, { asia: 1 });
});

test('the hour repeated when summer time ends keeps its own offset', () => {
  // London, 24 October 1982: 01:30 came first in BST (00:30 UTC), then again in GMT (01:30 UTC).
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  for (const [instant, offset] of [['1982-10-24T00:30:00.000Z', 60], ['1982-10-24T01:30:00.000Z', 0]] as const) {
    const local = wallClock(Date.parse(instant), formatter);
    assert.deepEqual(local, { date: '1982-10-24', time: '01:30', utcOffsetMinutes: offset });
    assert.equal(localDateTimeToUtc(local.date, local.time, 'Europe/London', local.utcOffsetMinutes).toISOString(), instant);
  }
});
