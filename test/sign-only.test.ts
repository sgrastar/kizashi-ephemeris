import test from 'node:test';
import assert from 'node:assert/strict';
import { fortuneSky } from '../src/sky.js';
import { addDays } from '../src/calendar.js';

const dates = Array.from({ length: 14 }, (_, index) => addDays('2026-10-19', index));

test('a chosen sign reads Solar Sign houses from that sign without natal planets', () => {
  const result = fortuneSky({ sign: 4, houseSystem: 'solar-sign', timezone: 'Asia/Tokyo', dates, outer: true, features: true });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const sky = result.value;
  assert.equal(sky.natal.timeKnown, false);
  assert.equal(sky.natal.planets, null);
  assert.equal(sky.natal.solarSign, 4);
  assert.deepEqual(sky.natal.cusps.slice(0, 3), [120, 150, 180]);
  assert.equal(sky.outerNatal, null);
  assert.equal(sky.prepared?.signOnly, true);
  for (const day of sky.features!) {
    // No natal points: neither noon contacts with natal targets nor perfections.
    assert.ok(day.features.contacts.every(contact => !contact.target.startsWith('natal.')), day.features.date);
    assert.deepEqual(day.perfections.perfections, []);
    assert.equal(day.perfections.lords, null);
    // The Moon's house counts from the chosen sign.
    const expected = ((Math.floor(day.features.moon.longitude / 30) - 4 + 12) % 12) + 1;
    assert.equal(day.features.house, expected, day.features.date);
  }
});

test('a chosen sign excludes birth data and other house systems', () => {
  const profile = { date: '1990-06-21', time: null, timezone: 'Asia/Tokyo' };
  const both = fortuneSky({ sign: 0, profile, houseSystem: 'solar-sign', timezone: 'Asia/Tokyo', dates, outer: false, features: false });
  assert.equal(both.ok, false);
  const neither = fortuneSky({ houseSystem: 'solar-sign', timezone: 'Asia/Tokyo', dates, outer: false, features: false });
  assert.equal(neither.ok, false);
  const whole = fortuneSky({ sign: 0, houseSystem: 'whole-sign', timezone: 'Asia/Tokyo', dates, outer: false, features: false });
  assert.equal(whole.ok, false);
  const outOfRange = fortuneSky({ sign: 12, houseSystem: 'solar-sign', timezone: 'Asia/Tokyo', dates, outer: false, features: false });
  assert.equal(outOfRange.ok, false);
});
