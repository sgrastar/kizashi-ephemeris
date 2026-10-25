/** Lahiri sidereal positions and chart divisions, isolated from the tropical APIs. */
import type { SwissEph } from '@typescriptify/sweph/dist/SwissEph/index.js';
import { SE_SUN, SE_MOON, SE_MARS, SE_MERCURY, SE_JUPITER, SE_VENUS, SE_SATURN,
  SE_MEAN_NODE, SE_URANUS, SE_NEPTUNE, SE_PLUTO, SE_ECL_NUT, SEFLG_NONUT,
  SEFLG_SIDEREAL, SE_SIDM_LAHIRI, SEFLG_MOSEPH } from '@typescriptify/sweph/dist/constants.js';
import { normalizeDegrees, angularSeparation } from './ephemeris.js';
import { longitude4, rounded } from './life-transits.js';
import type { GrahaName, ReferenceBody, Nakshatra, JyotishPosition, JyotishGraha, JyotishDignity } from './jyotish-types.js';

export const GRAHAS = ['sun', 'moon', 'mars', 'mercury', 'jupiter', 'venus', 'saturn', 'rahu', 'ketu'] as const;
export const DASHA_LORDS: readonly GrahaName[] = ['ketu', 'venus', 'sun', 'moon', 'mars', 'rahu', 'jupiter', 'saturn', 'mercury'];
export const GRAHA_IDS: Record<GrahaName | ReferenceBody, number> = {
  sun: SE_SUN, moon: SE_MOON, mars: SE_MARS, mercury: SE_MERCURY, jupiter: SE_JUPITER,
  venus: SE_VENUS, saturn: SE_SATURN, rahu: SE_MEAN_NODE, ketu: SE_MEAN_NODE,
  uranus: SE_URANUS, neptune: SE_NEPTUNE, pluto: SE_PLUTO,
};
const NAMES = ['ashwini', 'bharani', 'krittika', 'rohini', 'mrigashira', 'ardra', 'punarvasu', 'pushya',
  'ashlesha', 'magha', 'purva-phalguni', 'uttara-phalguni', 'hasta', 'chitra', 'swati', 'vishakha',
  'anuradha', 'jyeshtha', 'mula', 'purva-ashadha', 'uttara-ashadha', 'shravana', 'dhanishta',
  'shatabhisha', 'purva-bhadrapada', 'uttara-bhadrapada', 'revati'];

export function nakshatra(longitude: number): Nakshatra {
  const units = normalizeDegrees(longitude) * 3 / 40;
  const index = Math.min(26, Math.floor(units + 1e-12));
  const fraction = Math.max(0, units - index);
  return { index: index + 1, name: NAMES[index], pada: Math.min(4, Math.floor(fraction * 4 + 1e-12) + 1),
    lord: DASHA_LORDS[index % 9], fraction };
}

/** Nine equal divisions per sign; movable/fixed/dual starts are encoded by the continuous modulo. */
export function navamsaSign(longitude: number): number {
  return Math.floor(normalizeDegrees(longitude) * 3 / 10 + 1e-12) % 12;
}
export const fromSign = (longitude: number, firstSign: number) => (Math.floor(normalizeDegrees(longitude) / 30) - firstSign + 12) % 12 + 1;

/** Lahiri is the handover's conventional default, not an empirical claim of a unique zodiac. */
export function setJyotishMode(engine: SwissEph): void { engine.setSiderealMode(SE_SIDM_LAHIRI); }

/** The TS library returns the mean value even from getAyanamsaExUt; native C's default includes nutation. */
export function lahiriAyanamsa(engine: SwissEph, jd: number, nutation = true): number {
  return engine.getAyanamsa(jd) + (nutation ? engine.calc(jd, SE_ECL_NUT).distance : 0);
}

export function siderealPosition(engine: SwissEph, jd: number, body: GrahaName | ReferenceBody) {
  // Mean nodes are the specified traditional convention. Ketu is exactly opposite Rahu, with the same speed.
  // Native swe_calc_ut adds NONUT for SIDEREAL. The TS port does not, so specify it explicitly.
  const p = engine.calc(jd, GRAHA_IDS[body], SEFLG_SIDEREAL | SEFLG_NONUT);
  if (!(p.flags & SEFLG_MOSEPH) || !Number.isFinite(p.longitude) || !Number.isFinite(p.longitudeSpeed)) {
    throw new Error('Invalid sidereal Moshier position.');
  }
  const longitude = normalizeDegrees(p.longitude + (body === 'ketu' ? 180 : 0));
  return { longitude, latitude: body === 'ketu' ? -p.latitude : p.latitude, speed: p.longitudeSpeed, sign: Math.floor(longitude / 30) };
}

export function jyotishDignity(body: GrahaName, longitude: number): JyotishDignity | null {
  if (body === 'rahu' || body === 'ketu') return null; // Traditions differ on nodal dignities; omit rather than choose silently.
  const sign = Math.floor(normalizeDegrees(longitude) / 30), degree = normalizeDegrees(longitude) % 30;
  const exalt: Partial<Record<GrahaName, number>> = { sun: 0, moon: 1, mars: 9, mercury: 5, jupiter: 3, venus: 11, saturn: 6 };
  const own: Partial<Record<GrahaName, number[]>> = { sun: [4], moon: [3], mars: [0, 7], mercury: [2, 5], jupiter: [8, 11], venus: [1, 6], saturn: [9, 10] };
  // Half-open degree ranges; Mercury's 15–20 Virgo and Moon's 3–30 Taurus take precedence over sign-wide exaltation.
  const moola: Partial<Record<GrahaName, [number, number, number]>> = { sun: [4, 0, 20], moon: [1, 3, 30], mars: [0, 0, 12],
    mercury: [5, 15, 20], jupiter: [8, 0, 10], venus: [6, 0, 15], saturn: [10, 0, 20] };
  const m = moola[body];
  if (m && sign === m[0] && degree >= m[1] && degree < m[2]) return 'moolatrikona';
  if (sign === exalt[body] && !(body === 'mercury' && degree >= 20)) return 'exaltation';
  if (sign === (exalt[body]! + 6) % 12) return 'debilitation';
  return own[body]?.includes(sign) ? 'own-sign' : null;
}

/** Common angular combustion limits; Mercury/Venus use their retrograde limits. Nodes and the Sun are excluded. */
export function isCombust(body: GrahaName, longitude: number, sun: number, retrograde: boolean): boolean {
  const limits: Partial<Record<GrahaName, number>> = { moon: 12, mars: 17, mercury: retrograde ? 12 : 14,
    jupiter: 11, venus: retrograde ? 8 : 10, saturn: 15 };
  const limit = limits[body];
  return limit !== undefined && angularSeparation(longitude, sun) < limit;
}

export function grahaPositions(engine: SwissEph, jd: number, moonSign: number, lagnaSign?: number): JyotishPosition[] {
  return GRAHAS.map(body => {
    const p = siderealPosition(engine, jd, body);
    return { body, longitude: longitude4(p.longitude), latitude: rounded(p.latitude), speed: rounded(p.speed, 6), sign: p.sign,
      ...(lagnaSign === undefined ? {} : { house: fromSign(p.longitude, lagnaSign) }),
      moonHouse: fromSign(p.longitude, moonSign), retrograde: p.speed < 0 };
  });
}

export function natalGrahas(engine: SwissEph, jd: number, moonSign: number, lagnaSign?: number): JyotishGraha[] {
  const positions = grahaPositions(engine, jd, moonSign, lagnaSign), sun = siderealPosition(engine, jd, 'sun').longitude;
  return positions.map(p => {
    const longitude = siderealPosition(engine, jd, p.body).longitude;
    return { ...p, combust: isCombust(p.body, longitude, sun, p.retrograde), dignity: jyotishDignity(p.body, longitude),
      nakshatra: nakshatra(longitude), navamsaSign: navamsaSign(longitude) };
  });
}
