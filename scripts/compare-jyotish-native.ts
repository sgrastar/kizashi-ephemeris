/** Offline native-C evidence, including flag semantics and inherited TS-port residuals. */
import { createSwissEph, Ayanamsa, Flag } from '@kuntay/swisseph';
import { SwissEph } from '@typescriptify/sweph/dist/SwissEph/index.js';
import { SEFLG_NONUT, SEFLG_SIDEREAL, SEFLG_MOSEPH, SEFLG_SPEED } from '@typescriptify/sweph/dist/constants.js';
import { createEngine, angularSeparation, normalizeDegrees } from '../src/ephemeris.js';
import { GRAHAS, GRAHA_IDS, setJyotishMode, siderealPosition, lahiriAyanamsa, nakshatra, navamsaSign } from '../src/jyotish-natal.js';
import type { GrahaName, ReferenceBody } from '../src/jyotish-types.js';
import { pathToFileURL } from 'node:url';

const signed = (a: number, b: number) => normalizeDegrees(a - b + 180) - 180;

export async function compareNativeJyotish() {
  const native = await createSwissEph(), translated = createEngine();
  native.setSiderealMode(Ayanamsa.Lahiri); setJyotishMode(translated);
  const bodies: readonly (GrahaName | ReferenceBody)[] = [...GRAHAS, 'uranus', 'neptune', 'pluto'];
  const maxima = { longitude: 0, latitude: 0, speed: 0, ayanamsa: 0, meanAyanamsa: 0, lagna: 0, inheritedResidualMismatch: 0 };
  const rows = [], classifications = [], boundaryProbes = [];
  try {
    for (let year = 1900; year <= 2100; year += 10) for (const month of [1, 4, 7, 10]) {
      const jd = SwissEph.julianDay(year, month, 1, 12);
      const aya = native.ayanamsa(jd, 'moshier'), nut = native.obliquity(jd, { ephemeris: 'moshier' }).nutationInLongitude;
      maxima.ayanamsa = Math.max(maxima.ayanamsa, Math.abs(lahiriAyanamsa(translated, jd) - aya));
      maxima.meanAyanamsa = Math.max(maxima.meanAyanamsa, Math.abs(lahiriAyanamsa(translated, jd, false) - (aya - nut)));
      const place = { latitude: 35.69, longitude: 139.69 };
      const asc = normalizeDegrees(translated.houses(jd, place, 'W').ascendant - lahiriAyanamsa(translated, jd));
      const nativeAsc = native.houses(jd, place.latitude, place.longitude, 'W', { flags: Flag.Sidereal }).ascendant;
      maxima.lagna = Math.max(maxima.lagna, angularSeparation(asc, nativeAsc));
      for (const body of bodies) {
        const id = GRAHA_IDS[body], extra = body === 'ketu' ? 180 : 0;
        const c = native.calc(jd, id, { ephemeris: 'moshier', flags: Flag.Sidereal | Flag.NoNutation });
        const t = siderealPosition(translated, jd, body), cLon = normalizeDegrees(c.longitude + extra);
        const tc = translated.calc(jd, id, SEFLG_NONUT), cc = native.calc(jd, id, { ephemeris: 'moshier', flags: Flag.NoNutation });
        const inherited = signed(tc.longitude, cc.longitude), residual = signed(t.longitude, cLon);
        const mismatch = Math.abs(inherited - residual);
        maxima.inheritedResidualMismatch = Math.max(maxima.inheritedResidualMismatch, mismatch);
        maxima.longitude = Math.max(maxima.longitude, Math.abs(residual));
        maxima.latitude = Math.max(maxima.latitude, Math.abs((body === 'ketu' ? -c.latitude : c.latitude) - t.latitude));
        maxima.speed = Math.max(maxima.speed, Math.abs(c.longitudeSpeed - t.speed));
        const classified = (lon: number) => ({ sign: Math.floor(lon / 30), nakshatra: nakshatra(lon).index,
          pada: nakshatra(lon).pada, navamsa: navamsaSign(lon) });
        const nativeClass = classified(cLon), translatedClass = classified(t.longitude);
        if (JSON.stringify(nativeClass) !== JSON.stringify(translatedClass)) classifications.push({ year, month, jd, body,
          nativeLongitude: cLon, translatedLongitude: t.longitude, native: nativeClass, translated: translatedClass });
        rows.push({ year, month, jdUt: jd, body, nativeLongitude: cLon, translatedLongitude: t.longitude,
          residualDegrees: residual, inheritedTropicalNonutResidualDegrees: inherited, inheritedResidualMismatch: mismatch });
      }
    }
    // Deliberately probe close to a native crossing; a random grid alone could conceal classification uncertainty.
    for (const [body, target] of [['sun', 0], ['moon', 40 / 3], ['moon', 10 / 3]] as const) {
      const jd = native.nextCrossing(GRAHA_IDS[body], target, 2451545, { ephemeris: 'moshier', flags: Flag.Sidereal | Flag.NoNutation });
      for (const seconds of [-60, 1, 60]) {
        const instant = jd + seconds / 86400;
        const c = native.calc(instant, GRAHA_IDS[body], { ephemeris: 'moshier', flags: Flag.Sidereal | Flag.NoNutation }).longitude;
        const t = siderealPosition(translated, instant, body).longitude;
        boundaryProbes.push({ body, target, secondsAfterNativeCrossing: seconds, jdUt: instant, nativeLongitude: c,
          translatedLongitude: t, native: { sign: Math.floor(c / 30), nakshatra: nakshatra(c).index, pada: nakshatra(c).pada, navamsa: navamsaSign(c) },
          translated: { sign: Math.floor(t / 30), nakshatra: nakshatra(t).index, pada: nakshatra(t).pada, navamsa: navamsaSign(t) } });
      }
    }
    return { convention: 'SE_SIDM_LAHIRI=1; identical Julian day UT; Moshier|SPEED|SIDEREAL|NONUT',
      requestedFlags: SEFLG_MOSEPH | SEFLG_SPEED | SEFLG_SIDEREAL | SEFLG_NONUT,
      translatedReturnedFlags: translated.calc(2451545, GRAHA_IDS.sun, SEFLG_NONUT | SEFLG_SIDEREAL).flags,
      positions: rows.length, maxima, boundaryClassificationDifferences: classifications, boundaryProbes, rows };
  } finally { native.dispose(); translated.close(); }
}

/** The public native wrapper hides returned flags, so use its bundled C WASM for this small control experiment. */
export async function nativeFlagEvidence() {
  const url = new URL('../node_modules/@kuntay/swisseph/wasm/swisseph.mjs', import.meta.url).href;
  const factory = (await import(url)).default;
  const module = await factory();
  const calc = module.cwrap('swe_calc_ut', 'number', ['number', 'number', 'number', 'number', 'number']);
  const ayan = module.cwrap('swe_get_ayanamsa_ex_ut', 'number', ['number', 'number', 'number', 'number']);
  const sid = module.cwrap('swe_set_sid_mode', null, ['number', 'number', 'number']);
  const close = module.cwrap('swe_close', null, []);
  const values = module._malloc(48), error = module._malloc(256);
  try {
    sid(1, 0, 0);
    const requested = SEFLG_MOSEPH | SEFLG_SPEED | SEFLG_SIDEREAL;
    const returned = calc(2451545, 0, requested, values, error);
    const longitude = module.getValue(values, 'double');
    const ayanamsas = [SEFLG_MOSEPH, SEFLG_MOSEPH | SEFLG_NONUT].map(flags => {
      const returned = ayan(2451545, flags, values, error);
      return { requestedFlags: flags, returnedFlags: returned, value: module.getValue(values, 'double') };
    });
    return { jdUt: 2451545, siderealMode: 1, requestedFlags: requested, returnedFlags: returned, longitude, ayanamsas };
  } finally { close(); module._free(values); module._free(error); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [comparison, flags] = await Promise.all([compareNativeJyotish(), nativeFlagEvidence()]);
  console.log(JSON.stringify({ ...comparison, nativeFlagEvidence: flags }, null, 2));
}
