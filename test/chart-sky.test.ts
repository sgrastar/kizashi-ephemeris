import test from 'node:test';
import assert from 'node:assert/strict';
import { daySky } from '../src/sky.js';

const profile = { date: '1981-12-15', time: '11:58', latitude: 35.7, longitude: 139.7, timezone: 'Asia/Tokyo' };
const sky = (extra: Record<string, unknown> = {}) => {
  const result = daySky({ profile, houseSystem: 'placidus', timezone: 'Asia/Tokyo', date: '2026-10-20', timeline: false, chart: true, ...extra } as never);
  assert.ok(result.ok);
  return result.value;
};

test("the chart extras give each body's motion and the true node at birth and today", () => {
  const chart = sky().chart!;
  assert.equal(chart.natal!.speeds.length, 10);
  // 1981-12-15: no body was retrograde; the true node stood in Cancer.
  assert.ok(chart.natal!.speeds.every(speed => speed > 0), JSON.stringify(chart.natal!.speeds));
  assert.ok(Math.abs(chart.natal!.node - 112.72) < 0.05, String(chart.natal!.node));
  // 2026-10-20 local noon: Venus, Saturn, Uranus and Neptune retrograde; the rest direct.
  const retrograde = chart.today.speeds.map(speed => speed < 0);
  assert.deepEqual(retrograde, [false, false, false, true, false, false, true, true, true, false]);
  assert.equal(chart.today.longitudes.length, 10);
  assert.ok(Math.abs(chart.today.longitudes[0] - 206.7) < 0.3, String(chart.today.longitudes[0]));
  assert.ok(chart.today.node >= 0 && chart.today.node < 360);
});

test('the chart extras are only computed when asked, and without a birth time there is no natal part', () => {
  const plain = daySky({ profile, houseSystem: 'placidus', timezone: 'Asia/Tokyo', date: '2026-10-20', timeline: false });
  assert.ok(plain.ok && plain.value.chart === undefined);
  const solar = sky({ houseSystem: 'solar-sign', profile: { date: '1990-03-03', timezone: 'Asia/Tokyo' } });
  assert.equal(solar.chart!.natal, null);
  assert.equal(solar.chart!.today.speeds.length, 10);
});
