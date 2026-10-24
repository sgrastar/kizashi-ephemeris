import test from 'node:test';
import assert from 'node:assert/strict';
import { createSwissEph } from '@kuntay/swisseph';
import { lifeSky } from '../src/sky.js';
import { createEngine, natalChart, eclipticPosition, planetPosition, utcToJulianDay, angularSeparation, houseOfLongitude, normalizeDegrees } from '../src/ephemeris.js';
import { LIFE_CALCULATION_VERSION } from '../src/life-sky.js';
import type { LifeSkyRequest, NowLifeSky, LifetimeLifeSky } from '../src/life-sky.js';
import { contactWindows, crossings, longitudePath, LIFE_BODIES } from '../src/life-transits.js';
import { MAJOR_ASPECTS } from '../src/features.js';
import { TROPICAL_YEAR_DAYS } from '../src/time-lords.js';

const profile = { date: '1990-11-02', time: '07:30', timezone: 'Asia/Tokyo', latitude: 35.69, longitude: 139.69 };
const input: LifeSkyRequest = { profile, houseSystem: 'whole-sign', timezone: 'Asia/Tokyo', today: '2026-10-23', zodiac: 'tropical', scope: 'now' };
let cachedNow: NowLifeSky | undefined, cachedLife: LifetimeLifeSky | undefined;
const compute = (extra: Partial<LifeSkyRequest> = {}) => {
  const r = lifeSky({ ...input, ...extra }); assert.ok(r.ok, r.ok ? '' : r.error.message); return r.value;
};
const now = () => cachedNow ??= compute() as NowLifeSky;
const lifetime = () => cachedLife ??= compute({ scope: 'lifetime' }) as LifetimeLifeSky;
const jd = (at: string) => utcToJulianDay(new Date(at));

test('now and lifetime wall times are logged for one invented profile', context => {
  let start = performance.now(); now(); const nowMs = performance.now() - start;
  start = performance.now(); lifetime(); const lifetimeMs = performance.now() - start;
  context.diagnostic(`lifeSky wall time: now=${nowMs.toFixed(1)} ms, lifetime=${lifetimeMs.toFixed(1)} ms (target <2000 ms each; suite runs concurrently).`);
  assert.equal(now().calculationVersion, LIFE_CALCULATION_VERSION);
  assert.equal(lifetime().scope, 'lifetime');
});

test('natal ecliptic latitudes and true horizon altitudes agree with the independently compiled C engine', async context => {
  const native = await createSwissEph(), engine = createEngine();
  let latitudeError = 0, altitudeError = 0;
  try {
    for (const p of [profile, { date: '1975-03-21', time: '23:10', timezone: 'Australia/Sydney', latitude: -33.87, longitude: 151.21 }]) {
      const result = p === profile ? now() : compute({ profile: p, houseSystem: 'placidus' });
      const n = result.natal;
      assert.equal(n.bodies.length, 10); assert.equal(n.cusps.length, 12); assert.ok(n.sky);
      for (const [i, body] of LIFE_BODIES.entries()) {
        const expected = native.calc(n.julianDayUt!, i, { ephemeris: 'moshier' });
        const horizontal = native.horizontal(n.julianDayUt!, i, p.latitude, p.longitude, 0, { ephemeris: 'moshier' });
        latitudeError = Math.max(latitudeError, Math.abs(n.bodies[i].latitude - expected.latitude));
        altitudeError = Math.max(altitudeError, Math.abs(n.sky.bodies[i].altitude - horizontal.altitude));
        assert.ok(Math.abs(n.bodies[i].latitude - expected.latitude) < .004, body);
        assert.ok(Math.abs(n.sky.bodies[i].altitude - horizontal.altitude) < .04, body);
        assert.ok(angularSeparation(n.sky.bodies[i].azimuth, horizontal.azimuth) < .04, body);
        assert.equal(n.bodies[i].house, houseOfLongitude(n.bodies[i].longitude, n.cusps));
        const direct = eclipticPosition(engine, n.julianDayUt!, body);
        assert.ok(Math.abs(direct.latitude - n.bodies[i].latitude) <= .000051);
      }
      const sun = planetPosition(engine, n.julianDayUt!, 'sun').longitude, moon = planetPosition(engine, n.julianDayUt!, 'moon').longitude;
      const sign = n.sect === 'day' ? 1 : -1;
      assert.equal(n.sect, p === profile ? 'day' : 'night');
      assert.equal(n.sect, native.sect(n.julianDayUt!, p.latitude, p.longitude).sect);
      assert.ok(angularSeparation(n.lots!.fortune, n.ascendant! + sign * (moon - sun)) < .00011);
      assert.ok(angularSeparation(n.lots!.spirit, n.ascendant! - sign * (moon - sun)) < .00011);
    }
    context.diagnostic(`Native comparison: max latitude=${latitudeError.toFixed(6)}°, max altitude=${altitudeError.toFixed(6)}°.`);
  } finally { native.dispose(); engine.close(); }
});

test('every contact exact and orb boundary recomputes correctly, including a continuous triple pass', () => {
  const s = now(), engine = createEngine(), chart = natalChart(engine, profile);
  try {
    const points: Record<string, number> = Object.fromEntries(LIFE_BODIES.slice(0, 7).map(body => [body, planetPosition(engine, chart.julianDayUt, body).longitude]));
    points.ascendant = chart.ascendant; points.midheaven = chart.midheaven;
    points.fortune = normalizeDegrees(chart.ascendant + points.moon - points.sun);
    points.spirit = normalizeDegrees(chart.ascendant + points.sun - points.moon);
    const ids = new Set<string>();
    for (const c of s.contacts) {
      const key = `${c.body}:${c.point}:${c.aspect}:${c.enter}`;
      assert.ok(!ids.has(key), key); ids.add(key);
      const angle = MAJOR_ASPECTS.find(a => a.name === c.aspect)!.angle;
      const orb = c.body === 'jupiter' || c.body === 'saturn' ? 3 : ['uranus', 'neptune', 'pluto'].includes(c.body) ? 2 : 1;
      const error = (at: string) => Math.abs(angularSeparation(planetPosition(engine, jd(at), c.body).longitude, points[c.point]) - angle);
      assert.ok(Math.abs(error(c.enter) - orb) < .0001, JSON.stringify(c));
      assert.ok(Math.abs(error(c.leave) - orb) < .0001, JSON.stringify(c));
      assert.equal(new Set(c.exact).size, c.exact.length);
      for (const at of c.exact) { assert.ok(error(at) < .0001, JSON.stringify(c)); assert.ok(at > c.enter && at < c.leave); }
    }
    const triple = s.contacts.find(c => c.body === 'pluto' && c.point === 'sun' && c.aspect === 'square' && c.exact.length === 3)!;
    assert.ok(triple); assert.ok(triple.leave > s.window.end);
    const ordered = [...s.contacts].sort((a, b) => `${a.body}:${a.point}:${a.aspect}:${a.enter}`.localeCompare(`${b.body}:${b.point}:${b.aspect}:${b.enter}`));
    for (let i = 1; i < ordered.length; i++) {
      const a = ordered[i - 1], b = ordered[i];
      if (a.body === b.body && a.point === b.point && a.aspect === b.aspect) assert.ok(a.leave <= b.enter);
    }
  } finally { engine.close(); }
});

test('narrow between-sample contacts and near-miss stations produce complete windows', () => {
  const start = jd('2026-01-01T00:00:00Z');
  const linear = longitudePath(t => 100 + 20 * (t - start), start, start + 1, .25);
  const windows = contactWindows(linear, 'mercury', [{ point: 'sun', longitude: 102 }], 1, [{ name: 'conjunction', angle: 0 }]);
  assert.equal(windows.length, 1); assert.equal(windows[0].exact.length, 1);
  assert.ok(Math.abs(jd(windows[0].enter) - start - .05) < 2 / 86400);
  const minimum = longitudePath(t => 100.5 + (t - start - .37) ** 2, start, start + 2, 1, true);
  const near = contactWindows(minimum, 'saturn', [{ point: 'sun', longitude: 100 }], .6, [{ name: 'conjunction', angle: 0 }]);
  assert.equal(near.length, 1); assert.deepEqual(near[0].exact, []);
});

test('regression: contacts at search boundaries and exact grid nodes are retained once', () => {
  const start = jd('2026-01-01T00:00:00Z');
  const path = longitudePath(t => 99 + (t - start), start, start + 2, .25);
  const hits = crossings(path, [99, 100, 101]);
  assert.deepEqual(hits.map(e => e.jd - start), [0, 1, 2]);
  const windows = contactWindows(path, 'test-body', [{ point: 'sun', longitude: 100 }], 1, [{ name: 'conjunction', angle: 0 }]);
  assert.equal(windows.length, 1);
  assert.ok(Math.abs(jd(windows[0].enter) - start) < 2 / 86400);
  assert.ok(Math.abs(jd(windows[0].leave) - start - 2) < 2 / 86400);
  assert.equal(windows[0].angle, 0); assert.equal(windows[0].exact.length, 1);
  assert.ok(Math.abs(jd(windows[0].exact[0]) - start - 1) < 2 / 86400);
  const inside = longitudePath(t => 99.5 + (t - start), start, start + 1, .25);
  const open = contactWindows(inside, 'saturn', [{ point: 'sun', longitude: 100 }], 1, [{ name: 'conjunction', angle: 0 }]);
  assert.equal(open.length, 1);
  assert.ok(Math.abs(jd(open[0].enter) - start + .5) < 2 / 86400);
  assert.ok(Math.abs(jd(open[0].leave) - start - 1.5) < 2 / 86400);
  const turn = longitudePath(t => 101 - (t - start - 1) ** 2, start, start + 2, .25, true);
  assert.equal(crossings(turn, [101]).length, 1);
});

test('regression: rounded Lot of Fortune does not change releasing signs or Egyptian year lengths', () => {
  const p = { ...profile, longitude: 124.53503259027872 };
  const s = compute({ profile: p, scope: 'lifetime' });
  const engine = createEngine();
  try {
    const chart = natalChart(engine, p);
    const difference = planetPosition(engine, chart.julianDayUt, 'moon').longitude - planetPosition(engine, chart.julianDayUt, 'sun').longitude;
    const fortune = normalizeDegrees(chart.ascendant + (s.natal.sect === 'day' ? difference : -difference));
    assert.ok(fortune < 30 && fortune > 29.99995); assert.equal(s.natal.lots!.fortune, 30);
    const first = s.timeLords.releasing!.fortune.find(p => p.level === 1)!;
    assert.equal(first.sign, 0); assert.equal(first.fromFortune, 1);
    assert.equal((Date.parse(first.end) - Date.parse(first.start)) / 86400000, 15 * 360);
    const spirit = s.timeLords.releasing!.spirit.find(p => p.level === 1)!;
    assert.equal(spirit.fromFortune, spirit.sign + 1);
  } finally { engine.close(); }
});

test('regression: a rounded ASC does not change the annual profection sign', () => {
  const p = { ...profile, longitude: -88.91965688201218 };
  const s = compute({ profile: p, today: p.date });
  const engine = createEngine();
  try {
    const ascendant = natalChart(engine, p).ascendant;
    assert.ok(ascendant < 30 && ascendant > 29.99995); assert.equal(s.natal.ascendant, 30);
    const first = s.timeLords.profections!.years.find(p => p.age === 0)!;
    assert.equal(first.sign, 0); assert.equal(first.lord, 'mars');
  } finally { engine.close(); }
});

test('solar returns hit the natal longitude, and the 2027 return agrees with native swe_solcross_ut within a minute', async context => {
  const s = now(), engine = createEngine(), native = await createSwissEph();
  try {
    for (const ret of s.returns.solar) {
      assert.ok(angularSeparation(planetPosition(engine, jd(ret.at), 'sun').longitude, s.natal.bodies[0].longitude) < .0001);
      assert.equal(ret.approximate, false);
      if (!ret.approximate) { assert.equal(ret.cusps.length, 12); assert.equal(ret.bodies.length, 10); }
    }
    const ret = s.returns.solar.find(r => r.at.startsWith('2027-'))!;
    const nativeSun = native.calc(s.natal.julianDayUt!, 0, { ephemeris: 'moshier' }).longitude;
    const after = native.julianDay(2027, 1, 1);
    const reference = native.raw._swe_solcross_ut(nativeSun, after, 4, 0);
    assert.ok(Math.abs(jd(ret.at) - reference) * 86400 < 60);
    // The TS port has date-dependent apparent-position deviations; this is not a universal one-minute guarantee.
    const differences = s.returns.solar.map(r => Math.abs(jd(r.at) - native.raw._swe_solcross_ut(nativeSun, jd(r.at) - 3, 4, 0)) * 86400);
    context.diagnostic(`Native solar-return differences (seconds): ${differences.map(n => n.toFixed(1)).join(', ')}.`);
    assert.ok(s.returns.lunar.length >= 4);
  } finally { native.dispose(); engine.close(); }
});

test('all requested 2026–2027 eclipses are flagged on their UTC dates by global eclipse searches', () => {
  const eclipses = now().lunations.filter(l => l.eclipse).map(l => [l.at.slice(0, 10), l.eclipse]);
  for (const [date, kind] of [['2026-02-17', 'solar'], ['2026-08-12', 'solar'], ['2027-02-06', 'solar'], ['2027-08-02', 'solar'],
    ['2026-03-03', 'lunar'], ['2026-08-28', 'lunar'], ['2027-02-20', 'lunar'], ['2027-08-17', 'lunar']]) {
    assert.ok(eclipses.some(e => e[0] === date && e[1] === kind), `${date} ${kind}`);
  }
  assert.ok(now().lunations.some(l => l.eclipse === null));
  assert.ok(now().lunations.filter(l => l.eclipse).every(l => typeof l.eclipseType === 'number'));
});

test('ingresses merge coincident boundaries; stations use true changes of longitude motion', () => {
  const s = now(), engine = createEngine();
  try {
    const ids = new Set<string>();
    for (const e of s.ingresses) {
      assert.ok(!ids.has(`${e.body}:${e.at}`)); ids.add(`${e.body}:${e.at}`);
      const a = planetPosition(engine, jd(e.at) - 10 / 86400, e.body).longitude;
      const b = planetPosition(engine, jd(e.at) + 10 / 86400, e.body).longitude;
      assert.notEqual(Math.floor(a / 30), Math.floor(b / 30));
      assert.equal(e.sign, Math.floor(b / 30)); assert.equal(e.house, houseOfLongitude(b, s.natal.cusps));
    }
    for (const e of s.stations) {
      const at = jd(e.at), lon = planetPosition(engine, at, e.body).longitude;
      const before = normalizeDegrees(lon - planetPosition(engine, at - .1, e.body).longitude + 180) - 180;
      const after = normalizeDegrees(planetPosition(engine, at + .1, e.body).longitude - lon + 180) - 180;
      assert.ok(before * after < 0, JSON.stringify(e)); assert.equal(e.kind, after < 0 ? 'retrograde' : 'direct');
    }
    assert.ok(s.retrogrades.some(r => r.body === 'mars'));
    assert.ok(s.retrogrades.every(r => r.from < s.window.end && r.to > s.window.start && r.houses.length > 0));
  } finally { engine.close(); }
});

test('secondary phases and Moon returns recompute on the one-day-per-tropical-year scale', () => {
  const s = lifetime(), engine = createEngine();
  try {
    const at = (time: string) => s.natal.julianDayUt! + (jd(time) - s.natal.julianDayUt!) / TROPICAL_YEAR_DAYS;
    const names = ['new', 'crescent', 'first-quarter', 'gibbous', 'full', 'disseminating', 'last-quarter', 'balsamic'];
    for (const e of s.progressedPhases) {
      const angle = normalizeDegrees(planetPosition(engine, at(e.at), 'moon').longitude - planetPosition(engine, at(e.at), 'sun').longitude);
      assert.ok(angularSeparation(angle, names.indexOf(e.kind) * 45) < .0001);
    }
    assert.ok(s.progressedMoonReturns.length >= 3);
    for (const e of s.progressedMoonReturns) assert.ok(angularSeparation(planetPosition(engine, at(e.at), 'moon').longitude, s.natal.bodies[1].longitude) < .0001);
    assert.ok(s.timeLords.releasing!.fortune.every(p => p.level <= 2));
    assert.equal(s.timeLords.ptolemy.length, 7); assert.ok(s.milestones.some(c => c.body === 'saturn' && c.aspect === 'opposition'));
    assert.ok(s.progressedMoonIngresses.length > 30);
  } finally { engine.close(); }
});

test('life milestones: waxing before waning, no birth-year conjunction, Uranus trines and nodal returns, phase positions', () => {
  const s = lifetime(), engine = createEngine();
  try {
    const born = s.natal.instant!;
    const firstSaturn = (angle: number) => s.milestones.find(m => m.body === 'saturn' && m.angle === angle)!;
    // Saturn's waxing square (+90) comes at about 7, its waning one (-90) at about 22, before the return at about 29.
    assert.ok(firstSaturn(90).enter < firstSaturn(-90).enter && firstSaturn(-90).enter < firstSaturn(0).enter);
    assert.ok(s.milestones.every(m => m.aspect !== 'conjunction' || Date.parse(m.enter) - Date.parse(born) > 2 * 365 * 86_400_000));
    assert.ok(s.milestones.some(m => m.body === 'uranus' && m.aspect === 'trine' && m.angle === 120));
    const nodal = s.milestones.filter(m => m.body === 'node');
    // The mean node comes back every 18.6 years: four or five returns in ninety years.
    assert.ok(nodal.length >= 4 && nodal.length <= 5, String(nodal.length));
    for (const e of s.progressedPhases) {
      const moon = planetPosition(engine, s.natal.julianDayUt! + (jd(e.at) - s.natal.julianDayUt!) / TROPICAL_YEAR_DAYS, 'moon').longitude;
      assert.ok(angularSeparation(moon, e.longitude) < .001);
      assert.equal(e.house, houseOfLongitude(e.longitude, s.natal.cusps));
    }
  } finally { engine.close(); }
});

test('unknown time uses noon and solar houses, with no angles, lots or time-dependent time lords', () => {
  const s = compute({ profile: { date: profile.date, timezone: profile.timezone }, houseSystem: 'solar-sign' }) as NowLifeSky;
  assert.equal(s.natal.timeKnown, false); assert.equal(s.natal.instant, null); assert.equal(s.natal.julianDayUt, null);
  assert.equal(s.natal.ascendant, null); assert.equal(s.natal.midheaven, null); assert.equal(s.natal.lots, null);
  assert.equal(s.natal.sky, null); assert.equal(s.natal.sect, null); assert.equal(s.natal.bodies[0].house, 1);
  assert.ok(s.natal.bodies[1].range); assert.equal(s.timeLords.profections, null); assert.equal(s.timeLords.firdaria, null); assert.equal(s.timeLords.releasing, null);
  assert.equal(s.approximate, true); assert.equal(s.progressions.approximate, true);
  assert.ok(s.returns.solar.every(r => r.approximate && !('cusps' in r))); assert.deepEqual(s.returns.lunar, []);
  assert.ok(s.contacts.every(c => !['ascendant', 'midheaven', 'fortune', 'spirit'].includes(c.point)));
});

test('return charts use residence and explicitly fall back when Placidus is undefined there', () => {
  const s = compute({ houseSystem: 'placidus', residence: { latitude: 75, longitude: 20 } }) as NowLifeSky;
  assert.equal(s.natal.houseSystem, 'placidus');
  assert.ok(s.returns.solar.every(r => !r.approximate && r.fallback && r.houseSystem === 'whole-sign'));
  assert.ok(s.returns.lunar.every(r => r.fallback && r.houseSystem === 'whole-sign'));
});

test('bad data and polar natal Placidus failures are reported as Japanese input errors', () => {
  for (const patch of [{ zodiac: 'sidereal' }, { scope: 'bad' }, { houseSystem: 'bad' }, { residence: null }, { residence: { latitude: NaN, longitude: 0 } },
    { residence: { latitude: 0, longitude: 181 } }, { today: '2011-12-30', timezone: 'Pacific/Apia' }, { timezone: 'invalid' }, { today: '2026-02-30' }, { profile: null },
    { profile: { ...profile, time: null } }, { profile: { ...profile, date: '2100-12-31', time: '' } }, { houseSystem: 'solar-sign' }, { profile: { ...profile, utcOffsetMinutes: 900 } },
    { profile: { ...profile, latitude: 75 }, houseSystem: 'placidus' }]) {
    const r = lifeSky({ ...input, ...patch } as never);
    assert.equal(r.ok, false, JSON.stringify(patch)); if (!r.ok) assert.equal(r.error.kind, 'input');
  }
});

test('lifetime ends at the 2100 cap for a late invented birth', () => {
  const s = compute({ profile: { ...profile, date: '2098-11-02' }, scope: 'lifetime', today: '2099-01-01' });
  assert.equal(s.window.end, '2101-01-01T00:00:00Z');
});


test('the final supported civil birth day also works without a known time', () => {
  const s = compute({ profile: { date: '2100-12-31', timezone: 'Asia/Tokyo' }, houseSystem: 'solar-sign', scope: 'lifetime', today: '2100-12-31' });
  assert.equal(s.window.end, '2101-01-01T00:00:00Z');
  assert.equal(s.natal.timeKnown, false); assert.ok(s.natal.bodies[1].range);
});

test('regression: late-2100 western births have positive lifetime and now windows', () => {
  const cases = [
    { profile: { date: '2100-12-31', time: '23:30', timezone: 'America/Los_Angeles', latitude: 34, longitude: -118 },
      houseSystem: 'whole-sign' as const, end: '2101-01-01T08:00:00Z', birth: '2101-01-01T07:30:00Z' },
    { profile: { date: '2100-12-31', timezone: 'UTC-12:00' }, houseSystem: 'solar-sign' as const,
      end: '2101-01-01T12:00:00Z', birth: '2101-01-01T00:00:00Z' },
  ];
  for (const p of cases) {
    for (const scope of ['lifetime', 'now'] as const) {
      const s = compute({ profile: p.profile, houseSystem: p.houseSystem, timezone: p.profile.timezone, today: '2100-12-31', scope });
      assert.ok(s.window.end > s.window.start); assert.ok(s.window.end > p.birth);
      if (scope === 'lifetime') { assert.equal(s.window.start, p.birth); assert.equal(s.window.end, p.end); }
    }
  }
});

test('an unknown-time birth on a Sun-sign change day names the two signs to choose from', () => {
  const r = lifeSky({ ...input, profile: { date: '1990-03-21', timezone: 'Asia/Tokyo' }, houseSystem: 'solar-sign' });
  assert.equal(r.ok, false);
  if (!r.ok) assert.deepEqual(r.error.candidates, [11, 0]);
  assert.ok(lifeSky({ ...input, profile: { date: '1990-03-21', timezone: 'Asia/Tokyo', sunSign: 0 }, houseSystem: 'solar-sign' }).ok);
});
