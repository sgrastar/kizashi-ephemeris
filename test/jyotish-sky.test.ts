import test from 'node:test';
import assert from 'node:assert/strict';
import { jyotishSky, lifeSky, fortuneSky } from '../src/sky.js';
import type { JyotishSky, JyotishSkyRequest } from '../src/jyotish-types.js';
import { GRAHAS } from '../src/jyotish-natal.js';

const profile = { date: '1990-11-02', time: '07:30', latitude: 35.69, longitude: 139.69, timezone: 'Asia/Tokyo' };
const request: JyotishSkyRequest = { profile, timezone: 'Asia/Tokyo', today: '2026-10-24', scope: 'now' };
const memo = new Map<string, JyotishSky>();
const calculate = (r: JyotishSkyRequest) => {
  const key = JSON.stringify(r);
  if (!memo.has(key)) {
    const result = jyotishSky(r);
    if (!result.ok) throw new Error(result.error.message);
    memo.set(key, result.value);
  }
  return memo.get(key)!;
};

test('known-time RPC returns nine sidereal grahas, reference-only outer planets and mean retrograde nodes', () => {
  const s = calculate(request);
  assert.equal(s.zodiac, 'sidereal-lahiri'); assert.equal(s.ayanamsa, 'lahiri'); assert.equal(s.node, 'mean');
  assert.equal(s.approximate, false); assert.equal(s.natal.timeKnown, true);
  assert.equal(s.natal.instant, '1990-11-01T22:30:00.000Z');
  assert.deepEqual(s.natal.grahas.map(g => g.body), GRAHAS);
  assert.deepEqual(s.natal.outer.map(g => g.body), ['uranus', 'neptune', 'pluto']);
  assert.ok(s.natal.outer.every(body => !('dignity' in body) && !('nakshatra' in body)));
  assert.ok(s.natal.lagna);
  for (const g of s.natal.grahas) {
    assert.ok(g.sign >= 0 && g.sign < 12);
    assert.ok(g.house! >= 1 && g.house! <= 12);
    assert.ok(g.moonHouse >= 1 && g.moonHouse <= 12);
    assert.ok(g.nakshatra.index >= 1 && g.nakshatra.index <= 27);
    assert.ok(g.nakshatra.pada >= 1 && g.nakshatra.pada <= 4);
    assert.ok(g.navamsaSign >= 0 && g.navamsaSign < 12);
  }
  const rahu = s.natal.grahas.find(g => g.body === 'rahu')!, ketu = s.natal.grahas.find(g => g.body === 'ketu')!;
  assert.equal(rahu.retrograde, true); assert.equal(ketu.retrograde, true);
  assert.ok(Math.abs((rahu.longitude + 180) % 360 - ketu.longitude) < .0002);
  assert.equal(rahu.speed, ketu.speed);
  assert.equal(rahu.dignity, null); assert.equal(ketu.dignity, null);
});

test('now uses civil -12/+36 months, all nine ingress bodies, three dasha levels and matched eclipses', () => {
  const s = calculate(request);
  assert.equal(s.window.start, '2025-10-24T03:00:00Z');
  assert.equal(s.window.end, '2029-10-24T03:00:00Z');
  for (const body of GRAHAS) assert.ok(s.gochara.ingresses.some(event => event.body === body), body);
  assert.ok(s.dasha.maha.length && s.dasha.antar.length && s.dasha.pratyantar.length);
  assert.ok(s.dasha.current.maha && s.dasha.current.antar && s.dasha.current.pratyantar);
  const start = Date.parse(s.window.start), end = Date.parse(s.window.end);
  for (const event of [...s.gochara.ingresses, ...s.gochara.returns, ...s.lunations]) {
    assert.ok(Date.parse(event.at) >= start && Date.parse(event.at) < end);
  }
  assert.ok(s.gochara.ingresses.some(e => e.body === 'jupiter' && e.retrograde));
  assert.ok(s.lunations.some(l => l.eclipse === 'solar' && l.eclipseType));
  assert.ok(s.lunations.some(l => l.eclipse === 'lunar' && l.eclipseType));
  for (const e of s.gochara.ingresses.filter(e => e.body === 'rahu')) {
    const ketu = s.gochara.ingresses.find(k => k.body === 'ketu' && k.at === e.at)!;
    assert.equal((e.sign + 6) % 12, ketu.sign);
  }
});

test('lifetime is birth to the 90th civil anniversary with maha/antar and sidereal Jupiter/Saturn returns', () => {
  const s = calculate({ ...request, scope: 'lifetime' });
  assert.equal(s.window.start, '1990-11-01T22:30:00Z');
  assert.equal(s.window.end, '2080-11-01T22:30:00Z');
  assert.ok(s.dasha.maha.length >= 7); assert.ok(s.dasha.antar.length > 50);
  assert.equal(s.dasha.pratyantar.length, 0);
  assert.ok(s.dasha.current.pratyantar);
  assert.equal(s.lunations.length, 0);
  assert.ok(s.gochara.saturnPeriods.some(p => p.phase === 'rising'));
  assert.ok(s.gochara.saturnPeriods.some(p => p.phase === 'peak'));
  assert.ok(s.gochara.saturnPeriods.some(p => p.phase === 'setting'));
  assert.ok(s.gochara.saturnPeriods.some(p => p.kind === 'ashtama-shani'));
  for (const body of ['jupiter', 'saturn']) assert.ok(s.gochara.returns.some(r => r.body === body));
  assert.ok(s.gochara.returns.every(r => Date.parse(r.at) > Date.parse(s.window.start) + 86_400_000));
});

test('unknown-time birth returns explicit midnight endpoints and dasha ranges, with no lagna or lagna-house fields', () => {
  const s = calculate({ ...request, profile: { ...profile, time: null } });
  assert.equal(s.approximate, true); assert.equal(s.natal.timeKnown, false); assert.equal(s.natal.instant, null);
  assert.equal(s.natal.lagna, undefined);
  const check = (value: unknown): void => {
    if (Array.isArray(value)) value.forEach(check);
    else if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) {
      assert.notEqual(key, 'house'); check(item);
    }
  };
  check(s);
  const u = s.dasha.uncertainty!;
  assert.equal(u.birthWindow.start, '1990-11-01T15:00:00.000Z');
  assert.equal(u.birthWindow.end, '1990-11-02T15:00:00.000Z');
  assert.equal(u.alternatives.length, 2);
  assert.equal(u.alternatives[0].birthInstant, u.birthWindow.start);
  assert.equal(u.alternatives[1].birthInstant, u.birthWindow.end);
  assert.ok(u.alternatives.every(a => a.schedule.maha.length && a.schedule.antar.length && a.schedule.pratyantar.length));
  assert.ok(u.mahaStartRange[0] < u.mahaStartRange[1]);
  assert.ok(s.natal.moonRange && s.natal.moonRange[0] !== s.natal.moonRange[1]);
  assert.ok(s.gochara.positions.every(p => p.moonHouse >= 1));
});

test('DST fold offsets propagate to birth instants and lunar dasha seeds without overwriting one another', () => {
  const p = { date: '1990-10-28', time: '01:30', latitude: 40.71, longitude: -74.01, timezone: 'America/New_York' };
  const early = calculate({ ...request, profile: { ...p, utcOffsetMinutes: -240 } });
  const late = calculate({ ...request, profile: { ...p, utcOffsetMinutes: -300 } });
  assert.equal(early.natal.instant, '1990-10-28T05:30:00.000Z');
  assert.equal(late.natal.instant, '1990-10-28T06:30:00.000Z');
  assert.notEqual(early.dasha.birthBalance.end, late.dasha.birthBalance.end);
  assert.notEqual(early.natal.lagna!.longitude, late.natal.lagna!.longitude);
});

test('unknown-time bounds use the actual 23-hour spring DST day', () => {
  const s = calculate({ ...request, profile: { date: '2026-03-08', time: null, latitude: 40.71, longitude: -74.01, timezone: 'America/New_York' } });
  const window = s.dasha.uncertainty!.birthWindow;
  assert.equal((Date.parse(window.end) - Date.parse(window.start)) / 3_600_000, 23);
});

test('invalid dates, offsets, scope and dasha year units return input errors', () => {
  for (const patch of [{ today: '2026-02-30' }, { scope: 'wrong' }, { timezone: 'bad' }, { dashaYearDays: 0 },
    { profile: { ...profile, utcOffsetMinutes: 900 } }, { profile: { ...profile, time: '25:00' } }]) {
    const result = jyotishSky({ ...request, ...patch } as JyotishSkyRequest);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.kind, 'input');
  }
});

test('the last accepted birth day retains unknown-time endpoints and generates windows beyond 2100', () => {
  const last = { ...request, today: '2100-12-31', profile: { ...profile, date: '2100-12-31', time: null } };
  const now = calculate(last), lifetime = calculate({ ...last, scope: 'lifetime' });
  assert.equal(now.window.end, '2103-12-31T03:00:00Z');
  assert.equal(now.dasha.uncertainty!.birthWindow.end, '2100-12-31T15:00:00.000Z');
  assert.equal(lifetime.window.end, '2190-12-31T03:00:00Z');
  assert.ok(lifetime.gochara.returns.some(event => event.at.startsWith('21')));
});

test('sidereal RPC state never changes subsequent tropical lifeSky or fortuneSky results in the same process', () => {
  const lifeRequest = { ...request, houseSystem: 'whole-sign' as const, zodiac: 'tropical' as const };
  const watchRequest = { profile, houseSystem: 'whole-sign' as const, timezone: 'Asia/Tokyo', dates: ['2026-10-24'], outer: true, features: false };
  const beforeLife = lifeSky(lifeRequest), beforeWatch = fortuneSky(watchRequest);
  assert.equal(beforeLife.ok, true); assert.equal(beforeWatch.ok, true);
  assert.equal(jyotishSky(request).ok, true);
  assert.deepEqual(lifeSky(lifeRequest), beforeLife);
  assert.deepEqual(fortuneSky(watchRequest), beforeWatch);
});
