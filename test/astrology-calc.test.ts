import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createSwissEph, Body, HouseSystem } from '@kuntay/swisseph';
import { SwissEph } from '@typescriptify/sweph/dist/SwissEph/index.js';
import { createEngine, angularSeparation, natalChart, planetPosition, wholeSignHouse, houseOfLongitude,
  utcToJulianDay, CALCULATION_VERSION, SOLAR_CALCULATION_VERSION, PLACIDUS_CALCULATION_VERSION,
  KOCH_CALCULATION_VERSION, EQUAL_CALCULATION_VERSION, ENABLED_HOUSE_SYSTEMS, calculationVersionFor } from '../src/ephemeris.js';
import { ANY_BIRTH_ZONE, parseDate, localDateTimeToUtc, dayBounds } from '../src/calendar.js';

const profile = { date: '1990-01-01', time: '12:00', latitude: 35.68, longitude: 139.69, timezone: 'Asia/Tokyo' };

test('J2000 planetary reference is close to independently compiled native Swiss Ephemeris', () => {
  // Swiss Ephemeris 2.10.03, native C compiled to WASM by @kuntay/swisseph.
  // https://github.com/kuntayerkus/swisseph-wasm/blob/main/docs/ARCHITECTURE.md
  // Fixed UT JD, apparent geocentric tropical coordinates, Moshier + speed.
  const reference = {
    sun: 280.36891967534336, moon: 223.32377543840957, mercury: 271.8892750074874,
    venus: 241.5657983261687, mars: 327.9633133185202,
  } as const;
  const engine = createEngine();
  try {
    for (const planet of Object.keys(reference) as (keyof typeof reference)[]) {
      assert.ok(angularSeparation(planetPosition(engine, 2451545, planet).longitude, reference[planet]) < 0.02);
    }
  } finally { engine.close(); }
});

test('display-only outer planets are checked against native C Moshier across 1900–2100', async context => {
  const native = await createSwissEph();
  const translated = createEngine();
  const bodies = [Body.Jupiter, Body.Saturn, Body.Uranus, Body.Neptune, Body.Pluto];
  const names = ['jupiter', 'saturn', 'uranus', 'neptune', 'pluto'] as const;
  let maximumDifference = 0;
  let checked = 0;
  try {
    for (const year of [1900, 1950, 2000, 2026, 2100]) for (const month of [1, 4, 7, 10]) {
      const jd = SwissEph.julianDay(year, month, 1, 12);
      for (const [index, body] of bodies.entries()) {
        const difference = angularSeparation(planetPosition(translated, jd, names[index]).longitude,
          native.calc(jd, body, { ephemeris: 'moshier' }).longitude);
        maximumDifference = Math.max(maximumDifference, difference);
        assert.ok(difference < 0.02, `year=${year}, month=${month}, body=${body}, difference=${difference}`);
        checked++;
      }
    }
    assert.equal(checked, 100);
    context.diagnostic(`Outer-planet comparison: ${checked} positions, maximum difference ${maximumDifference.toFixed(8)} degrees.`);
  } finally {
    native.dispose(); translated.close();
  }
});

test('420 positions across 1900–2100 and Whole Sign angles are checked against native C WASM', async () => {
  const native = await createSwissEph();
  const translated = createEngine();
  let checked = 0;
  let maximumDifference = 0;
  try {
    for (let year = 1900; year <= 2100; year += 10) {
      for (const month of [1, 4, 7, 10]) {
        const jd = SwissEph.julianDay(year, month, 1, 12);
        for (const planet of [Body.Sun, Body.Moon, Body.Mercury, Body.Venus, Body.Mars]) {
          const difference = angularSeparation(translated.calc(jd, planet).longitude,
            native.calc(jd, planet, { ephemeris: 'moshier' }).longitude);
          maximumDifference = Math.max(maximumDifference, difference);
          // The TS port has observable apparent-position deviations; this test
          // deliberately uses a measured prototype bound, not its 1" claim.
          assert.ok(difference < 0.02, `year=${year}, month=${month}, body=${planet}, difference=${difference}`);
          checked++;
        }
        for (const place of [
          { latitude: 35.68, longitude: 139.69 },
          { latitude: 40.71, longitude: -74.01 },
          { latitude: 69.65, longitude: 18.96 },
        ]) {
          const a = translated.houses(jd, place, 'W');
          const b = native.houses(jd, place.latitude, place.longitude, HouseSystem.EqualWholeSign);
          assert.ok(angularSeparation(a.ascendant, b.ascendant) < 1e-8);
          assert.ok(angularSeparation(a.mc, b.midheaven) < 1e-8);
          a.cusps.slice(1, 13).forEach((cusp, i) => assert.ok(angularSeparation(cusp, b.cusps[i]) < 1e-8,
            `year=${year},month=${month},latitude=${place.latitude},cusp=${i + 1},TS=${cusp},WASM=${b.cusps[i]}`));
        }
      }
    }
    assert.equal(checked, 420);
    assert.ok(maximumDifference > 0.007, 'Do not hide the known TS-port/native deviation.');
  } finally {
    native.dispose(); translated.close();
  }
});

test('birth date/time uses the birth IANA timezone and date rollover', () => {
  assert.equal(localDateTimeToUtc('1990-01-01', '00:30', 'Asia/Tokyo').toISOString(), '1989-12-31T15:30:00.000Z');
  assert.equal(localDateTimeToUtc('1990-01-01', '12:00', 'Asia/Tokyo').toISOString(), '1990-01-01T03:00:00.000Z');
  assert.equal(localDateTimeToUtc('2026-07-01', '12:00', 'America/New_York').toISOString(), '2026-07-01T16:00:00.000Z');
  assert.equal(localDateTimeToUtc('2026-01-01', '12:00', 'America/New_York').toISOString(), '2026-01-01T17:00:00.000Z');
});

test('the any-zone birth day spans every civil zone from UTC+14 to UTC-12', () => {
  assert.deepEqual(dayBounds('2000-03-20', ANY_BIRTH_ZONE),
    { s: Date.parse('2000-03-19T10:00:00Z') / 1000, e: Date.parse('2000-03-21T12:00:00Z') / 1000 });
});

test('DST gaps move forward and repeated hours take the earlier instant unless an offset is given', () => {
  // 02:30 does not exist on 2026-03-08 in New York; it is read as 03:30 EDT.
  assert.equal(localDateTimeToUtc('2026-03-08', '02:30', 'America/New_York').toISOString(), '2026-03-08T07:30:00.000Z');
  // 01:30 happens twice on 2026-11-01; without an offset the first (EDT) is used.
  assert.equal(localDateTimeToUtc('2026-11-01', '01:30', 'America/New_York').toISOString(), '2026-11-01T05:30:00.000Z');
  assert.equal(localDateTimeToUtc('2026-11-01', '01:30', 'America/New_York', -240).toISOString(), '2026-11-01T05:30:00.000Z');
  assert.equal(localDateTimeToUtc('2026-11-01', '01:30', 'America/New_York', -300).toISOString(), '2026-11-01T06:30:00.000Z');
  // An explicit offset is the clock's actual offset at birth and is used as given,
  // even where the zone history disagrees (older local rules can be missing).
  assert.equal(localDateTimeToUtc('2026-11-01', '01:30', 'America/New_York', 540).toISOString(), '2026-10-31T16:30:00.000Z');
  assert.equal(localDateTimeToUtc('2026-03-08', '02:30', 'America/New_York', -300).toISOString(), '2026-03-08T07:30:00.000Z');
  assert.equal(localDateTimeToUtc('1960-07-01', '12:00', 'Europe/Oslo', 120).toISOString(), '1960-07-01T10:00:00.000Z');
  assert.throws(() => localDateTimeToUtc('2026-11-01', '01:30', 'America/New_York', 841), /-840 から 840/);
  assert.throws(() => localDateTimeToUtc('2026-11-01', '01:30', 'America/New_York', 90.5), /-840 から 840/);
  // Past DST rules come from the IANA history: Japan used UTC+10 in summer 1950, Berlin UTC+2 in summer 1990.
  assert.equal(localDateTimeToUtc('1950-07-01', '12:00', 'Asia/Tokyo').toISOString(), '1950-07-01T02:00:00.000Z');
  assert.equal(localDateTimeToUtc('1990-07-01', '12:00', 'Europe/Berlin').toISOString(), '1990-07-01T10:00:00.000Z');
  assert.equal(localDateTimeToUtc('1990-01-01', '12:00', 'Europe/Berlin').toISOString(), '1990-01-01T11:00:00.000Z');
  // A short DST period (Fiji, summer 2020-21) is not missed, with or without the offset.
  assert.equal(localDateTimeToUtc('2021-01-01', '12:00', 'Pacific/Fiji').toISOString(), '2020-12-31T23:00:00.000Z');
  assert.equal(localDateTimeToUtc('2021-01-01', '12:00', 'Pacific/Fiji', 780).toISOString(), '2020-12-31T23:00:00.000Z');
  // Lord Howe moves its clocks by 30 minutes: 01:45 repeats on 2026-04-05; 02:15 is skipped on 2026-10-04 and read as 02:45.
  assert.equal(localDateTimeToUtc('2026-04-05', '01:45', 'Australia/Lord_Howe').toISOString(), '2026-04-04T14:45:00.000Z');
  assert.equal(localDateTimeToUtc('2026-10-04', '02:15', 'Australia/Lord_Howe').toISOString(), '2026-10-03T15:45:00.000Z');
  // Abbreviations the runtime accepts keep working.
  assert.equal(localDateTimeToUtc('2026-01-01', '12:00', 'JST').toISOString(), '2026-01-01T03:00:00.000Z');
});

test('civil-day boundaries handle 23/25-hour DST days instead of adding 86400', () => {
  const spring = dayBounds('2026-03-08', 'America/New_York');
  const autumn = dayBounds('2026-11-01', 'America/New_York');
  assert.equal(spring.e - spring.s, 23 * 3600);
  assert.equal(autumn.e - autumn.s, 25 * 3600);
  assert.equal(new Date(spring.s * 1000).toISOString(), '2026-03-08T05:00:00.000Z');
  // Where DST starts at midnight the day starts at 01:00 (Santiago, 2026-09-06).
  const santiago = dayBounds('2026-09-06', 'America/Santiago');
  assert.equal(new Date(santiago.s * 1000).toISOString(), '2026-09-06T04:00:00.000Z');
  assert.equal(santiago.e - santiago.s, 23 * 3600);
  assert.throws(() => dayBounds('2011-12-30', 'Pacific/Apia'), /存在しません/);
  // Toronto, 1919-03-31: the clocks went from 23:30 to 00:30, so the day starts at 00:30 and lasts 23.5 hours.
  const toronto = dayBounds('1919-03-31', 'America/Toronto');
  assert.equal(new Date(toronto.s * 1000).toISOString(), '1919-03-31T04:30:00.000Z');
  assert.equal(dayBounds('1919-03-30', 'America/Toronto').e, toronto.s);
  assert.equal(toronto.e - toronto.s, 23.5 * 3600);
  const fiji = dayBounds('2021-01-01', 'Pacific/Fiji');
  assert.equal(new Date(fiji.s * 1000).toISOString(), '2020-12-31T11:00:00.000Z');
  assert.equal(fiji.e - fiji.s, 24 * 3600);
});

test('each birth field independently affects its expected calculated quantity', () => {
  const engine = createEngine();
  try {
    const original = natalChart(engine, profile);

    const dateOnly = natalChart(engine, { ...profile, date: '1990-05-01' });
    assert.ok(angularSeparation(original.planets.sun.longitude, dateOnly.planets.sun.longitude) > 100,
      'Changing only the birth date must alter the natal Sun.');

    const timeOnly = natalChart(engine, { ...profile, time: '18:00' });
    assert.ok(angularSeparation(original.ascendant, timeOnly.ascendant) > 30,
      'Changing only the birth time must alter the ascendant.');

    const longitudeOnly = natalChart(engine, { ...profile, longitude: 141.69 });
    assert.ok(angularSeparation(original.ascendant, longitudeOnly.ascendant) > 0.1,
      'Changing only birthplace longitude must alter the ascendant.');
    assert.equal(longitudeOnly.instant, original.instant);
    assert.equal(longitudeOnly.planets.sun.longitude, original.planets.sun.longitude,
      'Geocentric natal planets must not change when only the observer longitude changes.');

    const latitudeOnly = natalChart(engine, { ...profile, latitude: 45.68 });
    assert.ok(angularSeparation(original.ascendant, latitudeOnly.ascendant) > 0.1,
      'Changing only birthplace latitude away from the equator must alter the ascendant.');
    assert.equal(latitudeOnly.instant, original.instant);
    assert.equal(latitudeOnly.planets.sun.longitude, original.planets.sun.longitude);

    const timezoneOnly = natalChart(engine, { ...profile, timezone: 'America/New_York' });
    assert.equal(original.instant, '1990-01-01T03:00:00.000Z');
    assert.equal(timezoneOnly.instant, '1990-01-01T17:00:00.000Z');
    assert.ok(angularSeparation(original.ascendant, timezoneOnly.ascendant) > 30,
      'Changing only the birth timezone must change the resolved instant and ascendant.');
  } finally { engine.close(); }
});

test('general cusp intervals support unequal spans and wraparound', () => {
  const cusps = [350, 10, 35, 70, 95, 125, 165, 190, 230, 270, 300, 325];
  assert.equal(houseOfLongitude(350, cusps), 1);
  assert.equal(houseOfLongitude(0, cusps), 1);
  assert.equal(houseOfLongitude(9.999, cusps), 1);
  assert.equal(houseOfLongitude(10, cusps), 2);
  assert.equal(houseOfLongitude(35, cusps), 3);
  assert.equal(houseOfLongitude(349.999, cusps), 12);
  assert.throws(() => houseOfLongitude(20, cusps.slice(0, 11)), /twelve finite/);
  assert.throws(() => houseOfLongitude(20, [...cusps].reverse()), /one ordered/);
  assert.throws(() => houseOfLongitude(20, [350, 10, 10, ...cusps.slice(3)]), /one ordered/);
});

test('7,776 Placidus/Koch/Equal cusps across 1900–2100 agree with independently compiled native Swiss Ephemeris', async () => {
  const native = await createSwissEph();
  const translated = createEngine();
  let checked = 0;
  try {
    for (const houseSystem of ['placidus', 'koch', 'equal'] as const) {
      const nativeSystem = houseSystem === 'placidus' ? HouseSystem.Placidus : houseSystem === 'koch' ? HouseSystem.Koch : HouseSystem.Equal;
      for (let year = 1900; year <= 2100; year += 25) for (const month of [1, 4, 7, 10]) {
        for (const place of [
          { latitude: 0, longitude: 0 },
          { latitude: 35.68, longitude: 139.69 },
          { latitude: 40.71, longitude: -74.01 },
          { latitude: 51.5074, longitude: -0.1276 },
          { latitude: -33.86, longitude: 151.21 },
          { latitude: 64.13, longitude: -21.9 },
        ]) {
          const natal = natalChart(translated, { date: `${year}-${String(month).padStart(2, '0')}-01`,
            time: '12:00', timezone: 'UTC', ...place }, houseSystem);
          const reference = native.houses(natal.julianDayUt, place.latitude, place.longitude, nativeSystem);
          assert.equal(reference.substituted, false);
          assert.ok(angularSeparation(natal.ascendant, reference.ascendant) < 1e-8);
          assert.ok(angularSeparation(natal.midheaven, reference.midheaven) < 1e-8);
          for (const [index, cusp] of natal.cusps.entries()) {
            assert.ok(angularSeparation(cusp, reference.cusps[index]) < 1e-8,
              `${houseSystem}, ${year}-${month}, latitude=${place.latitude}, cusp=${index + 1}`);
            assert.equal(houseOfLongitude(cusp, natal.cusps), index + 1);
            checked++;
          }
        }
      }
    }
    assert.equal(checked, 7776);
  } finally { native.dispose(); translated.close(); }
});

