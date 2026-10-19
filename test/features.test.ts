import test from 'node:test';
import assert from 'node:assert/strict';
import { createEngine, planetPosition, utcToJulianDay, angularSeparation, normalizeDegrees, PLANET_IDS } from '../src/ephemeris.js';
import { addDays, localDateTimeToUtc, dayBounds } from '../src/calendar.js';
import { prepareNatal, dayFeatures, voidOfCourse, moonReaches, MAJOR_ASPECTS, phaseEventBetween, longitudeRangeOverDay, moonDignity, VOID_MITIGATING_SIGNS } from '../src/features.js';
import { SE_JUPITER, SE_SATURN } from '@typescriptify/sweph/dist/constants.js';
import type { SwissEph } from '@typescriptify/sweph/dist/SwissEph/index.js';

/**
 * Independent void-of-course reference: sample the unwrapped Moon−planet angle
 * every five minutes, bisect each exact-aspect crossing and the sign ingress,
 * and compare the two instants. This never calls voidOfCourse/moonReaches.
 */
// Derived from the aspect table rather than typed by hand: a Moon−planet angle
// of a or 360−a (and one wrap later) is exact for aspect angle a.
const EXACT_TARGETS = [...new Set(MAJOR_ASPECTS.flatMap(a => [a.angle, 360 - a.angle, a.angle + 360, 720 - a.angle]))].sort((a, b) => a - b);
function referenceVoid(engine: SwissEph, jd: number): boolean {
  const bodies = [PLANET_IDS.sun, PLANET_IDS.mercury, PLANET_IDS.venus, PLANET_IDS.mars, SE_JUPITER, SE_SATURN];
  const moonAt = (t: number) => planetPosition(engine, t, 'moon');
  const sign0 = moonAt(jd).sign;
  const step = 5 / 1440;
  // Ingress instant by bisection on the sign change.
  let t = jd;
  while (moonAt(t + step).sign === sign0) t += step;
  let low = t, high = t + step;
  for (let i = 0; i < 40; i++) { const mid = (low + high) / 2; if (moonAt(mid).sign === sign0) low = mid; else high = mid; }
  const ingress = (low + high) / 2;
  const relative = (time: number, body: number, previous: number) => {
    let value = normalizeDegrees(moonAt(time).longitude - engine.calc(time, body).longitude);
    while (value < previous - 180) value += 360;
    return value;
  };
  for (const body of bodies) {
    let prevTime = jd, prev = relative(jd, body, -Infinity);
    for (let time = jd + step; time <= ingress + step; time += step) {
      const cur = relative(time, body, prev);
      for (const exact of EXACT_TARGETS) {
        if (exact > prev && exact <= cur) {
          let a = prevTime, b = time;
          for (let i = 0; i < 40; i++) { const mid = (a + b) / 2; if (relative(mid, body, prev) < exact) a = mid; else b = mid; }
          if ((a + b) / 2 < ingress) return false;
        }
      }
      prevTime = time; prev = cur;
    }
  }
  return true;
}

const known = { profile: { date: '1990-01-01', time: '12:00', latitude: 35.68, longitude: 139.69, timezone: 'Asia/Tokyo' }, houseSystem: 'whole-sign' as const, timezone: 'Asia/Tokyo' };
const unknown = { profile: { date: '1978-04-02', time: null, timezone: 'Asia/Tokyo' }, houseSystem: 'solar-sign' as const, timezone: 'Asia/Tokyo' };

test('void-of-course agrees with an independent crossing-based reference over 120 noons', () => {
  const engine = createEngine();
  try {
    let voidDays = 0;
    for (let i = 0; i < 120; i++) {
      const date = addDays('2026-01-01', i);
      const jd = utcToJulianDay(localDateTimeToUtc(date, '12:00', 'Asia/Tokyo'));
      const result = voidOfCourse(engine, jd);
      assert.equal(result.void, referenceVoid(engine, jd), `${date}: analytic void=${result.void}`);
      assert.ok(result.ingressJd > jd && result.ingressJd < jd + 3);
      if (result.void) voidDays++;
    }
    assert.ok(voidDays > 0 && voidDays < 60, `void days in 120: ${voidDays}`);
  } finally { engine.close(); }
});

test('phase events occur about every 29.5 days and never twice in a day', () => {
  const engine = createEngine();
  try {
    const dates: string[] = [];
    for (let i = 0; i < 365; i++) {
      const date = addDays('2026-01-01', i);
      const s = utcToJulianDay(localDateTimeToUtc(date, '00:00', 'Asia/Tokyo'));
      const e = utcToJulianDay(localDateTimeToUtc(addDays(date, 1), '00:00', 'Asia/Tokyo'));
      if (phaseEventBetween(engine, s, e) === 'new') dates.push(date);
    }
    assert.ok(dates.length === 12 || dates.length === 13, `new moons: ${dates.join(',')}`);
    for (let i = 1; i < dates.length; i++) {
      const gap = (Date.parse(dates[i]) - Date.parse(dates[i - 1])) / 86400000;
      assert.ok(gap >= 29 && gap <= 30, `gap ${gap} between ${dates[i - 1]} and ${dates[i]}`);
    }
  } finally { engine.close(); }
});

test('moonReaches returns the next forward crossing', () => {
  const engine = createEngine();
  try {
    const jd = utcToJulianDay(new Date('2026-03-01T03:00:00Z'));
    const moon = planetPosition(engine, jd, 'moon').longitude;
    const t = moonReaches(engine, jd, (moon + 10) % 360);
    assert.ok(t > jd && t < jd + 1.2);
    assert.ok(angularSeparation(planetPosition(engine, t, 'moon').longitude, (moon + 10) % 360) < 1e-5);
  } finally { engine.close(); }
});

test('a station-day natal range includes the turning point, so unknown-time contacts hold for every instant of the birth day', () => {
  const engine = createEngine();
  try {
    // Mercury stations retrograde on 2026-03-20 (UT); the civil UTC day straddles it.
    const bounds = dayBounds('2026-03-20', 'UTC');
    const startJd = utcToJulianDay(new Date(bounds.s * 1000));
    const endJd = utcToJulianDay(new Date(bounds.e * 1000 - 1000));
    const range = longitudeRangeOverDay(engine, startJd, endJd, 'mercury');
    const samples = Array.from({ length: 97 }, (_, i) => planetPosition(engine, startJd + i / 96, 'mercury').longitude);
    const inside = (value: number) => normalizeDegrees(value - range[0]) <= normalizeDegrees(range[1] - range[0]) + 1e-9;
    assert.ok(samples.every(inside), 'every hourly longitude must lie inside the reported range');
    const endpointSpan = Math.abs(((samples[96] - samples[0] + 540) % 360) - 180);
    assert.ok(normalizeDegrees(range[1] - range[0]) > endpointSpan, 'station extreme widens the endpoint span');
    // Non-station day: the next midnight itself must be inside the interval (closed interval).
    const plain = dayBounds('1994-05-02', 'UTC');
    const plainRange = longitudeRangeOverDay(engine, utcToJulianDay(new Date(plain.s * 1000)), utcToJulianDay(new Date(plain.e * 1000)), 'venus');
    const atMidnight = planetPosition(engine, utcToJulianDay(new Date(plain.e * 1000)), 'venus').longitude;
    assert.ok(normalizeDegrees(atMidnight - plainRange[0]) <= normalizeDegrees(plainRange[1] - plainRange[0]) + 1e-9);
    // Codex counter-example from the review: the sextile must now be judged on the widened range.
    const request = { profile: { date: '2026-03-20', time: null, timezone: 'UTC', sunSign: 11 }, houseSystem: 'solar-sign' as const, timezone: 'Etc/GMT-11' };
    const f = dayFeatures(engine, prepareNatal(engine, request), request, '2027-01-17');
    for (const c of f.contacts.filter(c => c.target === 'natal.mercury')) {
      const angle = MAJOR_ASPECTS.find(a => a.name === c.aspect)!.angle;
      for (const natal of samples) assert.ok(Math.abs(angularSeparation(f.moon.longitude, natal) - angle) <= 3 + 1e-9);
    }
  } finally { engine.close(); }
});

test('applying follows the analytic orb derivative, matching a one-second forward difference over 120 days', () => {
  const engine = createEngine();
  try {
    const prepared = prepareNatal(engine, known);
    assert.ok(prepared.natal.timeKnown);
    const natal = prepared.natal.planets;
    let checked = 0;
    for (let i = 0; i < 120; i++) {
      const f = dayFeatures(engine, prepared, known, addDays('2026-01-01', i));
      const moonLater = planetPosition(engine, f.julianDayUt + 1 / 86400, 'moon').longitude;
      for (const c of f.contacts) {
        if (c.target.startsWith('natal.a') || c.target === 'natal.mc' || c.target.startsWith('transit.')) continue;
        const planet = c.target.slice('natal.'.length) as keyof typeof natal;
        const angle = MAJOR_ASPECTS.find(a => a.name === c.aspect)!.angle;
        const orbLater = Math.abs(angularSeparation(moonLater, natal[planet].longitude) - angle);
        if (Math.abs(orbLater - c.orb) < 1e-7) continue; // exact within the second: direction undefined
        assert.equal(c.applying, orbLater < c.orb, `${f.date} ${c.target} ${c.aspect}`);
        checked++;
      }
    }
    assert.ok(checked > 50, `checked ${checked} contacts`);
    // Codex counter-example: a conjunction 0.018° from exact and still closing must be applying
    // even though exactness passes within the hour.
    const mars = dayFeatures(engine, prepared, known, '2026-02-11').contacts.find(c => c.target === 'natal.mars');
    assert.ok(mars && mars.aspect === 'conjunction' && mars.orb < 0.05 && mars.applying === true);
  } finally { engine.close(); }
});

