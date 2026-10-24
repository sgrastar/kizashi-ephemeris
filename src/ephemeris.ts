import { SwissEph } from '@typescriptify/sweph/dist/SwissEph/index.js';
import { sweHousesEx2 } from '@typescriptify/sweph/dist/swehouse.js';
import { SE_SUN, SE_MOON, SE_MERCURY, SE_VENUS, SE_MARS, SE_JUPITER, SE_SATURN, SE_URANUS,
  SE_NEPTUNE, SE_PLUTO, SE_TRUE_NODE, SEFLG_MOSEPH } from '@typescriptify/sweph/dist/constants.js';
import type { PlanetName } from './types.js';
import { FortuneInputError, localDateTimeToUtc, dayBounds } from './calendar.js';

export type HouseSystem = 'whole-sign' | 'solar-sign' | 'placidus' | 'koch' | 'equal';
export type EnabledHouseSystem = HouseSystem;
/**
 * Systems computed from the birth time and place by sweHousesEx2. Equal is not
 * a quadrant system (30° houses from the Ascendant, the MC is not cusp 10) but
 * shares the chart shape and the strict status checks.
 */
export type QuadrantHouseSystem = 'placidus' | 'koch' | 'equal';
export const ENABLED_HOUSE_SYSTEMS: readonly EnabledHouseSystem[] = ['whole-sign', 'solar-sign', 'placidus', 'koch', 'equal'];

export const HOUSE_SYSTEM_NAMES_JA: Readonly<Record<HouseSystem, string>> = Object.freeze({
  'whole-sign': 'ホールサイン', 'solar-sign': 'ソーラーサイン', placidus: 'プラシーダス', koch: 'コッホ', equal: 'イコール',
});

export interface BirthProfile {
  date: string;
  time?: string | null;
  latitude?: number;
  longitude?: number;
  timezone: string;
  utcOffsetMinutes?: number;
  /** An explicit choice on a birth date that spans two tropical Sun signs. */
  sunSign?: number;
}

export type KnownTimeBirthProfile = BirthProfile & { time: string };
export type KnownBirthProfile = KnownTimeBirthProfile & { latitude: number; longitude: number };

export interface Position {
  longitude: number;
  sign: number;
  speed: number;
}

interface NatalChartBase {
  cusps: number[];
  zodiac: 'tropical';
  ephemeris: 'moshier';
}

export interface WholeSignNatalChart extends NatalChartBase {
  timeKnown: true;
  instant: string;
  julianDayUt: number;
  planets: Record<PlanetName, Position>;
  ascendant: number;
  midheaven: number;
  houseSystem: 'whole-sign';
  solarSign: null;
}

export interface QuadrantNatalChart<House extends QuadrantHouseSystem = QuadrantHouseSystem> extends NatalChartBase {
  timeKnown: true;
  instant: string;
  julianDayUt: number;
  planets: Record<PlanetName, Position>;
  ascendant: number;
  midheaven: number;
  houseSystem: House;
  solarSign: null;
}

export interface KnownSolarNatalChart extends NatalChartBase {
  timeKnown: true;
  instant: string;
  julianDayUt: number;
  planets: Record<PlanetName, Position>;
  ascendant: null;
  midheaven: null;
  houseSystem: 'solar-sign';
  solarSign: number;
  solarSignCandidates: number[];
}

export interface UnknownSolarNatalChart extends NatalChartBase {
  timeKnown: false;
  instant: null;
  julianDayUt: null;
  planets: null;
  ascendant: null;
  midheaven: null;
  houseSystem: 'solar-sign';
  solarSign: number;
  solarSignCandidates: number[];
}

export type NatalChart = WholeSignNatalChart | QuadrantNatalChart | KnownSolarNatalChart | UnknownSolarNatalChart;

export const CALCULATION_VERSION = 'typescriptify-1.0.4-moshier-tropical-whole-sign-1';
export const SOLAR_CALCULATION_VERSION = 'typescriptify-1.0.4-moshier-tropical-solar-sign-1';
export const PLACIDUS_CALCULATION_VERSION = 'typescriptify-1.0.4-moshier-tropical-placidus-1';
export const KOCH_CALCULATION_VERSION = 'typescriptify-1.0.4-moshier-tropical-koch-1';
export const EQUAL_CALCULATION_VERSION = 'typescriptify-1.0.4-moshier-tropical-equal-1';

export function enabledHouseSystem(houseSystem: HouseSystem = 'whole-sign'): EnabledHouseSystem {
  if (!ENABLED_HOUSE_SYSTEMS.includes(houseSystem)) {
    throw new FortuneInputError('ハウス方式はホールサイン、ソーラーサイン、プラシーダス、コッホ、イコールから選択してください。');
  }
  return houseSystem;
}

export function calculationVersionFor(houseSystem: HouseSystem = 'whole-sign'): string {
  const versions: Record<EnabledHouseSystem, string> = {
    'whole-sign': CALCULATION_VERSION,
    'solar-sign': SOLAR_CALCULATION_VERSION,
    placidus: PLACIDUS_CALCULATION_VERSION,
    koch: KOCH_CALCULATION_VERSION,
    equal: EQUAL_CALCULATION_VERSION,
  };
  return versions[enabledHouseSystem(houseSystem)];
}
export const PLANET_IDS: Record<PlanetName, number> = {
  sun: SE_SUN, moon: SE_MOON, mercury: SE_MERCURY, venus: SE_VENUS, mars: SE_MARS,
};

/** Extra chart symbols only; these planets do not enter interpretation rules. */
export type OuterPlanetName = 'jupiter' | 'saturn' | 'uranus' | 'neptune' | 'pluto';
export type OuterPlanetLongitudes = [number, number, number, number, number];
export type OuterNatalLongitudes = OuterPlanetLongitudes | [null, null, null, null, null];
export const OUTER_PLANET_IDS: Record<OuterPlanetName, number> = {
  jupiter: SE_JUPITER, saturn: SE_SATURN, uranus: SE_URANUS, neptune: SE_NEPTUNE, pluto: SE_PLUTO,
};
const DISPLAY_PLANET_IDS: Record<PlanetName | OuterPlanetName, number> = { ...PLANET_IDS, ...OUTER_PLANET_IDS };

export function normalizeDegrees(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}

export function angularSeparation(a: number, b: number): number {
  const difference = normalizeDegrees(a - b);
  return Math.min(difference, 360 - difference);
}

export function wholeSignHouse(longitude: number, ascendant: number): number {
  return (Math.floor(normalizeDegrees(longitude) / 30) - Math.floor(normalizeDegrees(ascendant) / 30) + 12) % 12 + 1;
}

/**
 * General cusp-interval foundation for later unequal-house systems. A cusp
 * belongs to the house beginning there; the next cusp is exclusive. Cusps
 * must describe one increasing traversal around the zodiac, without sorting
 * or silently substituting another house system.
 */
export function houseOfLongitude(longitude: number, cusps: readonly number[]): number {
  if (!Number.isFinite(longitude) || cusps.length !== 12 || !cusps.every(Number.isFinite)) {
    throw new Error('A longitude and twelve finite house cusps are required.');
  }
  const spans = cusps.map((cusp, index) => normalizeDegrees(cusps[(index + 1) % 12] - cusp));
  if (spans.some(span => span <= 0) || Math.abs(spans.reduce((total, span) => total + span, 0) - 360) > 1e-7) {
    throw new Error('House cusps must form one ordered, nonempty zodiac cycle.');
  }
  for (let index = 0; index < cusps.length; index++) {
    if (normalizeDegrees(longitude - cusps[index]) < spans[index]) return index + 1;
  }
  throw new Error('Longitude did not fall inside the provided house cusps.');
}

/** Swiss UTC conversion keeps UTC and UT1 separate, using the engine's Delta T. */
export function utcToJulianDay(instant: Date): number {
  const result = SwissEph.utcToJd(
    instant.getUTCFullYear(), instant.getUTCMonth() + 1, instant.getUTCDate(),
    instant.getUTCHours(), instant.getUTCMinutes(), instant.getUTCSeconds(),
  );
  if (result.error || !Number.isFinite(result.tjdUt)) {
    throw new FortuneInputError('出生時刻を天体計算用の時刻に変換できません。');
  }
  return result.tjdUt;
}

export function planetPosition(engine: SwissEph, julianDayUt: number, planet: PlanetName | OuterPlanetName): Position {
  const position = engine.calc(julianDayUt, DISPLAY_PLANET_IDS[planet]);
  if (!(position.flags & SEFLG_MOSEPH) || !Number.isFinite(position.longitude)) {
    throw new Error('Configured Moshier ephemeris did not produce a valid position.');
  }
  const longitude = normalizeDegrees(position.longitude);
  return { longitude, sign: Math.floor(longitude / 30), speed: position.longitudeSpeed };
}

/** The Moon's true north node and its daily motion; the south node is the opposite point. */
export function lunarNode(engine: SwissEph, julianDayUt: number): { longitude: number; speed: number } {
  const position = engine.calc(julianDayUt, SE_TRUE_NODE);
  if (!Number.isFinite(position.longitude) || !Number.isFinite(position.longitudeSpeed)) {
    throw new Error('Configured Moshier ephemeris did not produce the lunar node.');
  }
  return { longitude: normalizeDegrees(position.longitude), speed: position.longitudeSpeed };
}

/** Fixed wire order: Jupiter, Saturn, Uranus, Neptune, Pluto. */
export function outerPlanetLongitudes(engine: SwissEph, julianDayUt: number): OuterPlanetLongitudes {
  return [
    planetPosition(engine, julianDayUt, 'jupiter').longitude,
    planetPosition(engine, julianDayUt, 'saturn').longitude,
    planetPosition(engine, julianDayUt, 'uranus').longitude,
    planetPosition(engine, julianDayUt, 'neptune').longitude,
    planetPosition(engine, julianDayUt, 'pluto').longitude,
  ];
}

export function validateProfile(profile: BirthProfile, houseSystem: HouseSystem = 'whole-sign'): void {
  const system = enabledHouseSystem(houseSystem);
  if (!profile || typeof profile.date !== 'string' || typeof profile.timezone !== 'string') {
    throw new FortuneInputError('出生年月日と出生地のタイムゾーンを指定してください。');
  }
  if ((profile.latitude !== undefined && (!Number.isFinite(profile.latitude) || Math.abs(profile.latitude) >= 89)) ||
      (profile.longitude !== undefined && (!Number.isFinite(profile.longitude) || Math.abs(profile.longitude) > 180))) {
    throw new FortuneInputError('出生地は緯度 -89 より大きく 89 より小さく、経度 -180 から 180 で指定してください。');
  }
  if (profile.sunSign !== undefined && (!Number.isInteger(profile.sunSign) || profile.sunSign < 0 || profile.sunSign > 11)) {
    throw new FortuneInputError('太陽星座は 0 から 11 の整数で指定してください。');
  }
  if (system !== 'solar-sign' &&
      (typeof profile.time !== 'string' || profile.latitude === undefined || profile.longitude === undefined)) {
    const name = HOUSE_SYSTEM_NAMES_JA[system];
    throw new FortuneInputError(`${name}方式には出生時刻と出生地の緯度・経度が必要です。`);
  }
  if (profile.time !== undefined && profile.time !== null && typeof profile.time !== 'string') {
    throw new FortuneInputError('出生時刻は HH:mm で指定するか、不明の場合は null にしてください。');
  }
}

function solarCusps(solarSign: number): number[] {
  return Array.from({ length: 12 }, (_, index) => normalizeDegrees((solarSign + index) * 30));
}

/**
 * A chart from a chosen sign alone (no birth data): that sign is the first house, as in Solar Sign
 * with an unknown birth time, and there are no natal planets.
 */
export function signNatalChart(sign: number): UnknownSolarNatalChart {
  if (!Number.isInteger(sign) || sign < 0 || sign > 11) throw new FortuneInputError('星座は0〜11の番号で指定してください。');
  return {
    timeKnown: false, instant: null, julianDayUt: null, planets: null,
    ascendant: null, midheaven: null, cusps: solarCusps(sign),
    houseSystem: 'solar-sign', solarSign: sign, solarSignCandidates: [sign],
    zodiac: 'tropical', ephemeris: 'moshier',
  };
}

function checkChosenSunSign(profile: BirthProfile, candidates: readonly number[]): number {
  if (profile.sunSign !== undefined) {
    if (!candidates.includes(profile.sunSign)) {
      throw new FortuneInputError('選択した太陽星座は、入力した出生情報の計算結果と一致しません。');
    }
    return profile.sunSign;
  }
  if (candidates.length !== 1) {
    throw new FortuneInputError('太陽星座が切り替わる日です。出生時刻が不明な場合は太陽星座を選択してください。', [...candidates]);
  }
  return candidates[0];
}

const HOUSE_LETTERS: Record<QuadrantHouseSystem, string> = { placidus: 'P', koch: 'K', equal: 'E' };

/**
 * SwissEph.houses() discards the status returned by sweHousesEx2. For P/K
 * that would silently accept Porphyry substitution at polar latitudes or
 * nonconvergent Placidus cusps. The existing Whole Sign route is unchanged.
 */
function quadrantHouses(engine: SwissEph, jd: number, profile: KnownBirthProfile, system: QuadrantHouseSystem) {
  const rawCusps = new Array<number>(37).fill(0);
  const angles = new Array<number>(10).fill(0);
  const warning = { value: '' };
  const name = HOUSE_SYSTEM_NAMES_JA[system];
  const invalid = () => new FortuneInputError(`${name}方式をこの出生地・日時では計算できません。ホールサインかソーラーサインを選択してください。`);
  const status = sweHousesEx2(engine.swed, jd, SEFLG_MOSEPH, profile.latitude, profile.longitude,
    HOUSE_LETTERS[system], rawCusps, angles, null, null, warning);
  if (status !== 0 || warning.value) throw invalid();
  const cusps = rawCusps.slice(1, 13);
  if (!Number.isFinite(angles[0]) || !Number.isFinite(angles[1]) || !cusps.every(Number.isFinite)) throw invalid();
  try { houseOfLongitude(cusps[0], cusps); } catch { throw invalid(); }
  if (angularSeparation(cusps[0], angles[0]) > 1e-7 ||
      (system !== 'equal' && angularSeparation(cusps[9], angles[1]) > 1e-7)) throw invalid();
  return { cusps: [0, ...cusps.map(normalizeDegrees)], ascendant: angles[0], mc: angles[1] };
}

export function natalChart(engine: SwissEph, profile: KnownBirthProfile, houseSystem?: 'whole-sign'): WholeSignNatalChart;
export function natalChart(engine: SwissEph, profile: KnownTimeBirthProfile, houseSystem: 'solar-sign'): KnownSolarNatalChart;
export function natalChart<House extends QuadrantHouseSystem>(engine: SwissEph, profile: KnownBirthProfile, houseSystem: House): QuadrantNatalChart<House>;
export function natalChart(engine: SwissEph, profile: BirthProfile, houseSystem?: HouseSystem): NatalChart;
export function natalChart(engine: SwissEph, profile: BirthProfile, houseSystem: HouseSystem = 'whole-sign'): NatalChart {
  const system = enabledHouseSystem(houseSystem);
  validateProfile(profile, system);
  if (profile.time === undefined || profile.time === null) {
    // Bounds identify possible Sun signs, never a guessed birth instant.
    // The Sun moves monotonically by roughly one degree during a civil day,
    // so these endpoint signs give the complete one/two-sign candidate set.
    const bounds = dayBounds(profile.date, profile.timezone);
    const startSun = planetPosition(engine, utcToJulianDay(new Date(bounds.s * 1000)), 'sun');
    const endSun = planetPosition(engine, utcToJulianDay(new Date(bounds.e * 1000 - 1000)), 'sun');
    const candidates = [...new Set([startSun.sign, endSun.sign])];
    const solarSign = checkChosenSunSign(profile, candidates);
    return {
      timeKnown: false, instant: null, julianDayUt: null, planets: null,
      ascendant: null, midheaven: null, cusps: solarCusps(solarSign),
      houseSystem: 'solar-sign', solarSign, solarSignCandidates: candidates,
      zodiac: 'tropical', ephemeris: 'moshier',
    };
  }
  const instant = localDateTimeToUtc(profile.date, profile.time, profile.timezone, profile.utcOffsetMinutes);
  const jd = utcToJulianDay(instant);
  // Whole Sign retains its original calculation order and geocentric values.
  const houses = system === 'whole-sign' ?
    engine.houses(jd, { latitude: profile.latitude!, longitude: profile.longitude! }, 'W') :
    system === 'solar-sign' ? null : quadrantHouses(engine, jd, profile as KnownBirthProfile, system);
  const planets = Object.fromEntries(Object.keys(PLANET_IDS).map(planet => [
    planet, planetPosition(engine, jd, planet as PlanetName),
  ])) as Record<PlanetName, Position>;
  checkChosenSunSign(profile, [planets.sun.sign]);
  if (system === 'solar-sign') {
    return {
      timeKnown: true, instant: instant.toISOString(), julianDayUt: jd, planets,
      ascendant: null, midheaven: null, cusps: solarCusps(planets.sun.sign),
      houseSystem: 'solar-sign', solarSign: planets.sun.sign, solarSignCandidates: [planets.sun.sign],
      zodiac: 'tropical', ephemeris: 'moshier',
    };
  }
  const cusps = houses!.cusps.slice(1, 13);
  if (!Number.isFinite(houses!.ascendant) || !Number.isFinite(houses!.mc) || cusps.length !== 12 || !cusps.every(Number.isFinite)) {
    throw new Error('Whole Sign houses could not be calculated.');
  }
  return {
    timeKnown: true, instant: instant.toISOString(), julianDayUt: jd, planets,
    ascendant: normalizeDegrees(houses!.ascendant), midheaven: normalizeDegrees(houses!.mc), solarSign: null,
    cusps, houseSystem: system, zodiac: 'tropical', ephemeris: 'moshier',
  };
}

export function createEngine(): SwissEph {
  return new SwissEph({ ephemeris: 'moshier', timeMode: 'ut' });
}

/** Apparent geocentric ecliptic coordinates, including latitude for horizon calculations. */
export function eclipticPosition(engine: SwissEph, jd: number, body: PlanetName | OuterPlanetName): Position & { latitude: number } {
  const position = engine.calc(jd, DISPLAY_PLANET_IDS[body]);
  if (!(position.flags & SEFLG_MOSEPH) || ![position.longitude, position.latitude, position.longitudeSpeed].every(Number.isFinite)) {
    throw new Error('Configured Moshier ephemeris did not produce valid ecliptic coordinates.');
  }
  const longitude = normalizeDegrees(position.longitude);
  return { longitude, latitude: position.latitude, speed: position.longitudeSpeed, sign: Math.floor(longitude / 30) };
}

/** House cusps at an already calculated instant, with the natal chart's strict polar checks. */
export function housesAt(engine: SwissEph, jd: number, geo: { latitude: number; longitude: number }, system: Exclude<HouseSystem, 'solar-sign'>) {
  const houses = system === 'whole-sign' ? engine.houses(jd, geo, 'W') :
    quadrantHouses(engine, jd, { ...geo, date: '2000-01-01', time: '12:00', timezone: 'UTC' }, system);
  return { ascendant: normalizeDegrees(houses.ascendant), midheaven: normalizeDegrees(houses.mc), cusps: houses.cusps.slice(1, 13).map(normalizeDegrees) };
}
