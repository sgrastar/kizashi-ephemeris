import test from 'node:test';
import assert from 'node:assert/strict';
import { profections, firdaria, zodiacalReleasing, ptolemyAges, TROPICAL_YEAR_DAYS } from '../src/time-lords.js';
import { dayBounds } from '../src/calendar.js';

const birth = '1990-01-01T00:00:00Z';
const end = '2080-01-01T00:00:00Z';
const days = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86400000;

test('annual profections activate signs, houses and traditional rulers at birth-zone birthdays', () => {
  const p = { date: '1990-11-02', timezone: 'Asia/Tokyo' };
  const { years } = profections(p, 7, '1990-11-01T15:00:00Z', '2028-01-01T00:00:00Z');
  for (const [age, house, lord] of [[0, 1, 'mars'], [1, 2, 'jupiter'], [2, 3, 'saturn'], [12, 1, 'mars'], [35, 12, 'venus']] as const) {
    const year = years.find(y => y.age === age)!;
    assert.equal(year.house, house); assert.equal(year.lord, lord); assert.equal(year.sign, (7 + age) % 12);
  }
  const current = profections(p, 7, '2026-11-01T14:59:59Z', '2026-11-01T15:00:01Z').years;
  assert.deepEqual(current.map(y => y.age), [35, 36]);
  assert.equal(current[1].start, '2026-11-01T15:00:00Z');
});

test('monthly profections use calendar months from the original birthday with month-end clamping', () => {
  const result = profections({ date: '2000-01-31', timezone: 'UTC' }, 0, '2001-01-31T00:00:00Z', '2002-01-31T00:00:00Z');
  assert.equal(result.months.length, 12);
  assert.equal(result.months[0].sign, 1); assert.equal(result.months[0].lord, 'venus');
  assert.equal(result.months[1].start, '2001-02-28T00:00:00Z');
  assert.equal(result.months[2].start, '2001-03-31T00:00:00Z');
  assert.equal(result.months[11].house, 1);
});

test('regression: profections start at the civil day boundary when DST skips midnight', () => {
  const p = { date: '1900-03-31', timezone: 'America/Toronto' };
  const boundary = new Date(dayBounds('1919-03-31', p.timezone).s * 1000).toISOString().replace('.000Z', 'Z');
  assert.equal(boundary, '1919-03-31T04:30:00Z');
  const result = profections(p, 0, '1919-03-31T04:29:59Z', '1919-03-31T04:30:01Z');
  assert.deepEqual(result.years.map(p => p.age), [18, 19]);
  assert.equal(result.years[0].end, boundary); assert.equal(result.years[1].start, boundary);
  assert.equal(result.months.find(p => p.age === 19 && p.month === 0)!.start, boundary);
});

test('day and night firdaria have the specified major sequences and repeat after 75 tropical years', () => {
  const day = firdaria(birth, 'day', birth, end), night = firdaria(birth, 'night', birth, end);
  assert.deepEqual(day.major.slice(0, 9).map(p => p.lord), ['sun', 'venus', 'mercury', 'moon', 'saturn', 'jupiter', 'mars', 'north-node', 'south-node']);
  assert.deepEqual(night.major.slice(0, 9).map(p => p.lord), ['moon', 'saturn', 'jupiter', 'mars', 'sun', 'venus', 'mercury', 'north-node', 'south-node']);
  assert.ok(Math.abs(days(birth, day.major[9].start) - 75 * TROPICAL_YEAR_DAYS) < 1 / 86400);
  assert.equal(day.major[9].lord, 'sun');
  assert.ok(Math.abs(days(day.major[0].start, day.major[0].end) - 10 * TROPICAL_YEAR_DAYS) < 1 / 86400);
});

test('firdaria sub-periods start with the major lord and continue in Chaldean order; nodes have none', () => {
  const day = firdaria(birth, 'day', birth, end), night = firdaria(birth, 'night', birth, end);
  assert.deepEqual(day.sub.slice(0, 7).map(p => p.lord), ['sun', 'venus', 'mercury', 'moon', 'saturn', 'jupiter', 'mars']);
  assert.deepEqual(night.sub.slice(0, 7).map(p => p.lord), ['moon', 'saturn', 'jupiter', 'mars', 'sun', 'venus', 'mercury']);
  assert.equal(day.sub[0].start, day.major[0].start); assert.equal(day.sub[6].end, day.major[0].end);
  assert.ok(Math.abs(days(day.sub[0].start, day.sub[1].start) - 10 * TROPICAL_YEAR_DAYS / 7) < 1 / 86400);
  assert.ok(day.sub.every(p => p.majorLord !== undefined));
  for (const node of day.major.filter(p => p.lord.includes('node'))) assert.ok(!day.sub.some(p => p.start >= node.start && p.start < node.end));
});

test('zodiacal releasing uses Egyptian years, Fortune-relative numbering and the L2 loosing of the bond', () => {
  const all = zodiacalReleasing(birth, 9, 0, birth, end, 3);
  const l1 = all.filter(p => p.level === 1);
  assert.deepEqual(l1.slice(0, 4).map(p => p.sign), [9, 10, 11, 0]);
  assert.equal(days(l1[0].start, l1[0].end), 27 * 360);
  assert.equal(l1[0].fromFortune, 10); assert.equal(l1[1].fromFortune, 11);
  assert.ok(l1.every(p => !p.loosed));
  const l2 = all.filter(p => p.level === 2 && p.start < l1[0].end);
  assert.deepEqual(l2.slice(0, 12).map(p => p.sign), [9, 10, 11, 0, 1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(l2[12].sign, 3); assert.equal(l2[12].loosed, true);
  assert.equal(l2.filter(p => p.loosed).length, 1);
  assert.equal(l2[18].sign, 9); assert.equal(l2[18].loosed, undefined);
  assert.equal(l2[12].fromFortune, 4);
  assert.equal(days(birth, l2[12].start), [15, 8, 20, 25, 19, 20, 8, 15, 12, 27, 30, 12].reduce((a, b) => a + b) * 30);
  for (const child of all.filter(p => p.level > 1)) assert.ok(all.some(p => p.level === child.level - 1 && p.start <= child.start && p.end >= child.end));
  assert.equal(l2.at(-1)!.end, l1[0].end);
});

test('releasing window filtering preserves actual parent ends, and supports optional L4', () => {
  const narrow = zodiacalReleasing(birth, 9, 9, '1991-01-01T00:00:00Z', '1991-02-01T00:00:00Z', 4);
  assert.ok(narrow.some(p => p.level === 4));
  assert.equal(narrow.find(p => p.level === 1)!.end, '2016-08-12T00:00:00Z');
  assert.ok(narrow.every(p => p.fromFortune >= 1 && p.fromFortune <= 12));
});

test('Ptolemy ages use the seven requested boundaries and an open-ended Saturn period', () => {
  const ages = ptolemyAges(birth);
  assert.deepEqual(ages.map(p => [p.lord, p.fromAge, p.toAge]), [['moon', 0, 4], ['mercury', 4, 14], ['venus', 14, 22],
    ['sun', 22, 41], ['mars', 41, 56], ['jupiter', 56, 68], ['saturn', 68, null]]);
  assert.equal(ages[6].end, null);
  assert.ok(Math.abs(days(birth, ages[6].start) - 68 * TROPICAL_YEAR_DAYS) < 1 / 86400);
});

test('pure time-lord functions reject malformed dates, signs and intervals', () => {
  assert.throws(() => profections({ date: '2000-02-30', timezone: 'UTC' }, 0, birth, end), { name: 'FortuneInputError' });
  assert.throws(() => firdaria('invalid', 'day', birth, end), { name: 'FortuneInputError' });
  assert.throws(() => zodiacalReleasing(birth, 12, 0, birth, end), { name: 'FortuneInputError' });
  assert.throws(() => zodiacalReleasing(birth, 0, 0, end, birth), { name: 'FortuneInputError' });
});
