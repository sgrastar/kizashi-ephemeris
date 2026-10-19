import test from 'node:test';
import assert from 'node:assert/strict';
import { Body, createSwissEph } from '@kuntay/swisseph';
import { angularSeparation, createEngine, planetPosition, utcToJulianDay } from '../src/ephemeris.js';
import { FortuneInputError } from '../src/calendar.js';
import { currentWeekStart, generateWeeklySky, normalizeWeeklySign, WEEKLY_SIGNS, WEEKLY_TIMEZONE } from '../src/weekly-sky.js';

test('current weekly period rolls over on Monday midnight JST, not UTC', () => {
  assert.equal(currentWeekStart(new Date('2026-10-11T14:59:59Z')), '2026-10-05');
  assert.equal(currentWeekStart(new Date('2026-10-11T15:00:00Z')), '2026-10-12');
  assert.equal(currentWeekStart(new Date('2026-10-14T06:00:00Z')), '2026-10-12');
  const sky = generateWeeklySky({ sign: 'aries' }, new Date('2026-10-11T15:00:00Z'));
  assert.deepEqual(sky.period, {
    startDate: '2026-10-12', endDate: '2026-10-18', endExclusiveDate: '2026-10-19',
    timezone: WEEKLY_TIMEZONE, startAt: '2026-10-11T15:00:00.000Z', endAt: '2026-10-18T15:00:00.000Z',
  });
  assert.equal(sky.days.length, 7);
  assert.equal(sky.days[0].at, '2026-10-12T03:00:00.000Z');
  assert.equal(sky.days.at(-1)?.at, '2026-10-18T03:00:00.000Z');
});

test('weekly inputs accept only valid signs and complete supported Monday weeks', () => {
  assert.equal(normalizeWeeklySign(' ARIES '), 0);
  assert.equal(normalizeWeeklySign('牡牛座'), 1);
  assert.equal(normalizeWeeklySign('さそり座'), 7);
  assert.equal(normalizeWeeklySign('11'), 11);
  for (const sign of [-1, 12, 1.5, Number.NaN, '', 'ophiuchus', '12', null, true, {}, 'constructor']) {
    assert.throws(() => generateWeeklySky({ sign, weekStart: '2026-10-05' } as never), FortuneInputError);
  }
  for (const weekStart of ['2026-02-30', '2026-10-06', '1899-12-25', '2100-12-27', '', null, 5]) {
    assert.throws(() => generateWeeklySky({ sign: 0, weekStart } as never), FortuneInputError);
  }
  assert.throws(() => currentWeekStart(new Date('invalid')), FortuneInputError);
  assert.throws(() => generateWeeklySky(null as never), FortuneInputError);
  assert.equal(generateWeeklySky({ sign: 0, weekStart: '1900-01-01' }).period.startDate, '1900-01-01');
});

test('all twelve signs share one sky and events, with sign-relative houses only', () => {
  const skies = WEEKLY_SIGNS.map(({ id }) => generateWeeklySky({ sign: id, weekStart: '2026-10-05' }));
  const baseline = skies[0];
  const withoutHouses = (sky: typeof baseline) => sky.days.map(day => ({
    ...day, planets: day.planets.map(({ house: _house, ...planet }) => planet),
  }));
  const engine = createEngine();
  try {
    for (const [index, sky] of skies.entries()) {
      assert.equal(sky.sign.index, index);
      assert.equal(sky.houseSystem, 'solar-sign');
      assert.equal(sky.zodiac, 'tropical');
      assert.deepEqual(withoutHouses(sky), withoutHouses(baseline));
      assert.deepEqual(sky.events, baseline.events, 'Event facts and IDs must not depend on the audience sign.');
      for (const day of sky.days) {
        assert.equal(day.planets.length, 7);
        assert.deepEqual(day.planets.map(planet => planet.planet), ['sun', 'moon', 'mercury', 'venus', 'mars', 'jupiter', 'saturn']);
        for (const planet of day.planets) {
          assert.equal(planet.house, (planet.sign - index + 12) % 12 + 1);
          assert.equal(planet.retrograde, planet.speed < 0);
          assert.equal(planet.signLabel, WEEKLY_SIGNS[planet.sign].label);
        }
      }
    }
    // The sign-only output retains actual sky positions instead of guessing a
    // natal birthday from the chosen sign, including slow Jupiter and Saturn.
    for (const day of baseline.days) for (const planet of day.planets) {
      const raw = planetPosition(engine, utcToJulianDay(new Date(day.at)), planet.planet);
      assert.equal(planet.longitude, raw.longitude);
    }
  } finally { engine.close(); }
});

test('daily aspects are transit pairs within the declared orb, with calculated applying direction', () => {
  const skies = ['2026-10-05', '2021-06-21', '2026-07-27', '2026-12-07', '2026-10-19']
    .map(weekStart => generateWeeklySky({ sign: 0, weekStart }));
  const engine = createEngine();
  let checked = 0;
  try {
    for (const sky of skies) for (const day of sky.days) for (const aspect of day.aspects) {
      const pair = aspect.planets.map(name => day.planets.find(planet => planet.planet === name)!);
      const orb = Math.abs(angularSeparation(pair[0].longitude, pair[1].longitude) - aspect.angle);
      assert.equal(aspect.orb, orb);
      assert.ok(orb <= 3);
      assert.equal(aspect.id, `${day.date}:${aspect.planets[0]}:${aspect.planets[1]}:${aspect.aspect}`);
      const jd = utcToJulianDay(new Date(Date.parse(day.at) + 60_000));
      const next = aspect.planets.map(name => planetPosition(engine, jd, name));
      const nextOrb = Math.abs(angularSeparation(next[0].longitude, next[1].longitude) - aspect.angle);
      if (orb > 0.02 && Math.abs(nextOrb - orb) > 1e-6) assert.equal(aspect.applying, nextOrb < orb);
      checked++;
    }
  } finally { engine.close(); }
  assert.ok(checked > 0);
  assert.equal(skies[0].calculationScope.exactTransitAspects, true);
  assert.equal(skies[0].calculationScope.snapshotLocalTime, '12:00');
});

test('new moon search handles the 360/0 wrap and agrees with a published lunar reference', () => {
  const sky = generateWeeklySky({ sign: 'pisces', weekStart: '2024-04-08' });
  const moon = sky.events.find(event => event.type === 'lunar-phase' && event.phase === 'new-moon');
  assert.ok(moon && moon.type === 'lunar-phase');
  // US Naval Observatory: 2024 Apr 8, 18:21 UT, at minute precision.
  // https://aa.usno.navy.mil/calculated/moon/phases?date=2024-4-08&format=p&nump=5&submit=Get+Data
  // This is a prototype ephemeris tolerance, separate from the 1-second root
  // bracket precision; the existing TS port differs from native Swiss values.
  assert.ok(Math.abs(Date.parse(moon.at) - Date.parse('2024-04-08T18:21:00Z')) < 3 * 60_000);
  assert.equal(moon.date, '2024-04-09', 'Publication civil dates use JST even when a reference uses UT.');
  assert.ok(angularSeparation(moon.sunLongitude, moon.moonLongitude) < 0.001);
  assert.equal(moon.angle, 0);
});

test('refined ingresses straddle their sign boundaries and stations agree with longitude motion', () => {
  const sky = generateWeeklySky({ sign: 'libra', weekStart: '2024-04-01' });
  const engine = createEngine();
  let ingresses = 0;
  let stations = 0;
  try {
    for (const event of sky.events) {
      if (event.type === 'lunar-phase' || event.type === 'transit-aspect') continue;
      const second = Date.parse(event.at);
      const before = planetPosition(engine, utcToJulianDay(new Date(second - 1000)), event.planet);
      const after = planetPosition(engine, utcToJulianDay(new Date(second)), event.planet);
      if (event.type === 'sign-ingress') {
        assert.equal(before.sign, event.fromSign);
        assert.equal(after.sign, event.toSign);
        assert.ok(angularSeparation(after.longitude, event.longitude) < 0.001);
        ingresses++;
      } else {
        // Independently check apparent longitude movement over an hour on
        // each side of the station, rather than reusing the TS speed field.
        const motionAt = (at: number) => {
          const first = planetPosition(engine, utcToJulianDay(new Date(at - 1800_000)), event.planet);
          const last = planetPosition(engine, utcToJulianDay(new Date(at + 1800_000)), event.planet);
          return (last.longitude - first.longitude + 540) % 360 - 180;
        };
        assert.equal(motionAt(second + 60_000) < 0, event.direction === 'retrograde');
        assert.notEqual(motionAt(second - 60_000) < 0, motionAt(second + 60_000) < 0);
        stations++;
      }
    }
  } finally { engine.close(); }
  assert.ok(ingresses > 0);
  assert.ok(stations > 0, 'This week includes Mercury changing to retrograde motion.');
});

test('events stay inside the half-open JST week and adjacent weeks do not duplicate them', () => {
  const current = generateWeeklySky({ sign: 'aries', weekStart: '2024-04-08' });
  const next = generateWeeklySky({ sign: 'taurus', weekStart: '2024-04-15' });
  for (const sky of [current, next]) {
    for (const event of sky.events) {
      assert.ok(Date.parse(event.at) >= Date.parse(sky.period.startAt));
      assert.ok(Date.parse(event.at) < Date.parse(sky.period.endAt));
      assert.ok(event.date >= sky.period.startDate && event.date <= sky.period.endDate);
    }
    assert.equal(new Set(sky.events.map(event => event.id)).size, sky.events.length);
    assert.deepEqual(sky.events.map(event => event.at), sky.events.map(event => event.at).sort());
  }
  assert.ok(next.events.some(event => event.type === 'lunar-phase' && event.phase === 'first-quarter'));
  assert.ok(!current.events.some(event => event.type === 'lunar-phase' && event.phase === 'first-quarter'));
  const currentIds = new Set(current.events.map(event => event.id));
  assert.ok(next.events.every(event => !currentIds.has(event.id)));
});

test('Jupiter station belongs to Monday JST, with no preceding-week event or duplicate', () => {
  const previous = generateWeeklySky({ sign: 'aries', weekStart: '2021-06-14' });
  const current = generateWeeklySky({ sign: 'taurus', weekStart: '2021-06-21' });
  const jupiterStations = (sky: typeof current) => sky.events.filter(event => event.type === 'station' && event.planet === 'jupiter');
  assert.equal(jupiterStations(previous).length, 0, 'The old translated speed incorrectly placed this station on Sunday JST.');
  const stations = jupiterStations(current);
  assert.equal(stations.length, 1);
  assert.equal(stations[0].date, '2021-06-21');
  assert.ok(Date.parse(stations[0].at) >= Date.parse(current.period.startAt));
  assert.equal(new Set([...previous.events, ...current.events].map(event => event.id)).size,
    previous.events.length + current.events.length);
  assert.equal(current.calculationVersion, 'typescriptify-1.0.4-moshier-tropical-weekly-solar-sign-3');
  assert.equal(current.calculationScope.eventSearchToleranceSeconds, 1);
  assert.equal(current.calculationScope.eventTimeAccuracy, 'prototype-ephemeris-not-guaranteed');
  assert.equal(current.calculationScope.longitudeSpeedMethod, 'central-difference');
});

test('within-week major aspect events are real angle crossings, including zodiac wrap and both oriented branches', () => {
  const skies = ['2024-04-08', '2026-10-05', '2026-10-12', '2021-06-21', '2026-10-19']
    .map(weekStart => generateWeeklySky({ sign: 'aries', weekStart }));
  const engine = createEngine();
  const seenAngles = new Set<number>();
  const seenBranches = new Set<string>();
  const angles = { conjunction: 0, sextile: 60, square: 90, trine: 120, opposition: 180 };
  let checked = 0;
  try {
    for (const sky of skies) {
      assert.deepEqual(sky.calculationScope.events, ['sign-ingress', 'lunar-phase', 'station', 'transit-aspect']);
      for (const event of sky.events) {
        if (event.type !== 'transit-aspect') continue;
        const instant = Date.parse(event.at);
        const at = (milliseconds: number) => event.planets.map(planet =>
          planetPosition(engine, utcToJulianDay(new Date(milliseconds)), planet));
        const exact = at(instant);
        assert.equal(event.longitudeA, exact[0].longitude);
        assert.equal(event.longitudeB, exact[1].longitude);
        const separation = angularSeparation(exact[0].longitude, exact[1].longitude);
        assert.equal(event.angle, angles[event.aspect]);
        assert.equal(event.separation, separation);
        assert.equal(event.orb, Math.abs(separation - event.angle));
        assert.ok(event.orb < 0.00025, `The integer-second root has excessive residual: ${event.id}`);
        assert.equal(event.id, `transit-aspect:${event.planets.join(':')}:${event.aspect}:${event.at}`);
        const before = at(instant - 1000);
        const after = at(instant);
        const oriented = (pair: typeof before) => ((pair[1].longitude - pair[0].longitude) % 360 + 360) % 360;
        const delta = (from: number, to: number) => ((to - from + 540) % 360) - 180;
        const target = event.angle === 0 || event.angle === 180 ? event.angle :
          oriented(exact) < 180 ? event.angle : 360 - event.angle;
        const residualBefore = delta(target, oriented(before));
        const residualAfter = delta(target, oriented(after));
        assert.ok(residualBefore === 0 || residualAfter === 0 || residualBefore * residualAfter < 0,
          `The event is not an exact crossing between its preceding second and timestamp: ${event.id}`);
        seenAngles.add(event.angle);
        if (event.angle === 60 || event.angle === 90 || event.angle === 120) {
          seenBranches.add(`${event.angle}:${target < 180 ? 'first' : 'second'}`);
        }
        checked++;
      }
    }
    assert.ok(checked > 50);
    assert.deepEqual([...seenAngles].sort((a, b) => a - b), [0, 60, 90, 120, 180]);
    for (const angle of [60, 90, 120]) {
      assert.ok(seenBranches.has(`${angle}:first`));
      assert.ok(seenBranches.has(`${angle}:second`));
    }
    const eclipse = skies[0];
    const phase = eclipse.events.find(event => event.type === 'lunar-phase' && event.phase === 'new-moon');
    const conjunction = eclipse.events.find(event => event.type === 'transit-aspect' &&
      event.aspect === 'conjunction' && event.planets.join(':') === 'sun:moon');
    assert.ok(phase && conjunction);
    assert.equal(phase.at, conjunction.at, 'The lunar phase and its pair aspect are distinct descriptions of the same crossing.');
  } finally { engine.close(); }
});

test('representative weekly exact aspects are compared with independent native C positions, without claiming second-level model accuracy', async context => {
  const native = await createSwissEph();
  const bodies = { sun: Body.Sun, jupiter: Body.Jupiter, mars: Body.Mars, saturn: Body.Saturn } as const;
  const fixtures = [
    // Measured TS/native timing drift is about 5 minutes and 16 minutes,
    // respectively. These bounds disclose the translated longitude model's
    // limitation separately from its one-second numerical search tolerance.
    { pair: ['sun', 'jupiter'], aspect: 'sextile', boundSeconds: 6 * 60 },
    { pair: ['mars', 'saturn'], aspect: 'trine', boundSeconds: 20 * 60 },
  ] as const;
  try {
    const sky = generateWeeklySky({ sign: 'aries', weekStart: '2026-10-12' });
    for (const fixture of fixtures) {
      const event = sky.events.find(event => event.type === 'transit-aspect' &&
        event.planets.join(':') === fixture.pair.join(':') && event.aspect === fixture.aspect);
      assert.ok(event && event.type === 'transit-aspect');
      const residualAt = (second: number) => {
        const pair = fixture.pair.map(planet => {
          const position = native.calc(utcToJulianDay(new Date(second * 1000)), bodies[planet], { ephemeris: 'moshier' });
          assert.equal(position.ephemeris, 'moshier');
          return position;
        });
        return angularSeparation(pair[0].longitude, pair[1].longitude) - event.angle;
      };
      let left = Date.parse(event.at) / 1000 - 6 * 3600;
      let right = Date.parse(event.at) / 1000 + 6 * 3600;
      assert.ok(residualAt(left) * residualAt(right) < 0, 'The native reference independently brackets this aspect.');
      const increasing = residualAt(right) > residualAt(left);
      while (right - left > 1) {
        const middle = Math.floor((left + right) / 2);
        if (increasing ? residualAt(middle) >= 0 : residualAt(middle) <= 0) right = middle;
        else left = middle;
      }
      const driftSeconds = Date.parse(event.at) / 1000 - right;
      assert.ok(Math.abs(driftSeconds) < fixture.boundSeconds,
        `${event.label}: ${driftSeconds}s exceeds disclosed model bound ${fixture.boundSeconds}s`);
      assert.ok(Math.abs(residualAt(right)) < 0.00002);
      context.diagnostic(`${event.label}: native exact time ${new Date(right * 1000).toISOString()}, TS/native drift ${driftSeconds}s.`);
    }
  } finally { native.dispose(); }
});

test('weekly motion and stations are compared with native C Moshier, with explicit prototype accuracy bounds', async context => {
  const native = await createSwissEph();
  const bodies = {
    sun: Body.Sun, moon: Body.Moon, mercury: Body.Mercury, venus: Body.Venus,
    mars: Body.Mars, jupiter: Body.Jupiter, saturn: Body.Saturn,
  } as const;
  const cases = [
    { planet: 'jupiter', weekStart: '2021-06-21', from: '2021-06-20', to: '2021-06-22', retrograde: true, boundSeconds: 45 * 60 },
    { planet: 'saturn', weekStart: '2026-07-27', from: '2026-07-25', to: '2026-07-28', retrograde: true, boundSeconds: 45 * 60 },
    { planet: 'jupiter', weekStart: '2026-12-07', from: '2026-12-11', to: '2026-12-14', retrograde: true, boundSeconds: 45 * 60 },
    { planet: 'mercury', weekStart: '2026-10-19', from: '2026-10-23', to: '2026-10-26', retrograde: true, boundSeconds: 60 },
    // The longitude model also has measurable station drift for direct
    // turns. These wider measured bounds keep that limitation visible;
    // a one-second search bracket does not imply one-second ephemeris accuracy.
    { planet: 'saturn', weekStart: '2026-12-07', from: '2026-12-10', to: '2026-12-12', retrograde: false, boundSeconds: 3 * 3600 },
    { planet: 'jupiter', weekStart: '2026-03-09', from: '2026-03-10', to: '2026-03-12', retrograde: false, boundSeconds: 60 * 60 },
    { planet: 'mercury', weekStart: '2026-03-16', from: '2026-03-20', to: '2026-03-22', retrograde: false, boundSeconds: 2 * 60 },
  ] as const;
  let maximumSpeedDifference = 0;
  try {
    for (const fixture of cases) {
      const sky = generateWeeklySky({ sign: 'aries', weekStart: fixture.weekStart });
      const station = sky.events.find(event => event.type === 'station' && event.planet === fixture.planet);
      assert.ok(station && station.type === 'station', `${fixture.planet} ${fixture.weekStart}`);
      assert.equal(station.direction, fixture.retrograde ? 'retrograde' : 'direct');
      const nativeSpeedAt = (second: number) => {
        const position = native.calc(utcToJulianDay(new Date(second * 1000)), bodies[fixture.planet], { ephemeris: 'moshier' });
        assert.equal(position.ephemeris, 'moshier');
        return position.longitudeSpeed;
      };
      let left = Date.parse(`${fixture.from}T00:00:00Z`) / 1000;
      let right = Date.parse(`${fixture.to}T00:00:00Z`) / 1000;
      assert.notEqual(nativeSpeedAt(left) < 0, fixture.retrograde);
      assert.equal(nativeSpeedAt(right) < 0, fixture.retrograde);
      while (right - left > 1) {
        const middle = Math.floor((left + right) / 2);
        if ((nativeSpeedAt(middle) < 0) === fixture.retrograde) right = middle;
        else left = middle;
      }
      const driftSeconds = Date.parse(station.at) / 1000 - right;
      assert.ok(Math.abs(driftSeconds) < fixture.boundSeconds,
        `${fixture.planet} ${station.direction}: TS/native station drift ${driftSeconds}s exceeds prototype bound ${fixture.boundSeconds}s`);
      context.diagnostic(`${fixture.planet} ${station.direction} ${station.date}: native station drift ${driftSeconds}s.`);
      for (const day of sky.days) for (const planet of day.planets) {
        const reference = native.calc(utcToJulianDay(new Date(day.at)), bodies[planet.planet], { ephemeris: 'moshier' });
        const difference = Math.abs(planet.speed - reference.longitudeSpeed);
        maximumSpeedDifference = Math.max(maximumSpeedDifference, difference);
        assert.ok(difference < 0.0003, `${day.date} ${planet.planet}: speed drift ${difference} degrees/day`);
        // Avoid interpreting tiny model deviations near a station as an
        // independent agreement on direction.
        if (Math.abs(reference.longitudeSpeed) > 0.0003) assert.equal(planet.retrograde, reference.longitudeSpeed < 0);
      }
    }
    context.diagnostic(`Daily longitude-speed maximum difference: ${maximumSpeedDifference.toFixed(8)} degrees/day.`);
  } finally { native.dispose(); }
});
