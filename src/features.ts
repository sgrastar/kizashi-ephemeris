/**
 * Prototype v2 sky features. Everything here is a calculated fact about the
 * sky at the display-zone local noon (or within the civil day). Interpretation
 * of those facts lives in the v2 catalog, not in this module.
 *
 * The existing v1 engine (src/astrology/fortune.ts) is untouched; this module
 * only reads from the shared ephemeris helpers.
 */
import { SwissEph } from '@typescriptify/sweph/dist/SwissEph/index.js';
import { SE_JUPITER, SE_SATURN, SEFLG_MOSEPH } from '@typescriptify/sweph/dist/constants.js';
import { angularSeparation, normalizeDegrees, planetPosition, houseOfLongitude, utcToJulianDay,
  natalChart, signNatalChart, PLANET_IDS } from './ephemeris.js';
import type { BirthProfile, HouseSystem, NatalChart, OuterPlanetName, Position } from './ephemeris.js';
import type { PlanetName, AspectName } from './types.js';
import { dayBounds, localDateTimeToUtc, timezoneFormatter } from './calendar.js';

export type Quarter = 'waxing-crescent' | 'waxing-gibbous' | 'waning-gibbous' | 'waning-crescent';
export type PhaseEvent = 'new' | 'first-quarter' | 'full' | 'last-quarter';
export type Element = 'fire' | 'earth' | 'air' | 'water';
export type Modality = 'cardinal' | 'fixed' | 'mutable';
export type MoonDignity = 'domicile' | 'exaltation' | 'detriment' | 'fall' | null;
export type NatalTarget = 'natal.sun' | 'natal.moon' | 'natal.mercury' | 'natal.venus' | 'natal.mars' | 'natal.jupiter' | 'natal.saturn';
export type AngleTarget = 'natal.asc' | 'natal.mc';
export type TransitTarget = 'transit.mercury' | 'transit.venus' | 'transit.mars';
export type ContactTarget = NatalTarget | AngleTarget | TransitTarget;

export const MAJOR_ASPECTS: readonly { name: AspectName; angle: number }[] = [
  { name: 'conjunction', angle: 0 }, { name: 'sextile', angle: 60 }, { name: 'square', angle: 90 },
  { name: 'trine', angle: 120 }, { name: 'opposition', angle: 180 },
];
/** Same orb as the v1 lunar/natal rule so v1 and v2 remain comparable. */
export const CONTACT_ORB = 3;
/** Tier 1 natal planets, 2 natal angles, 3 transit planets (Sun excluded: the phase covers it). */
export const CONTACT_TIER: Record<ContactTarget, 1 | 2 | 3> = {
  'natal.sun': 1, 'natal.moon': 1, 'natal.mercury': 1, 'natal.venus': 1, 'natal.mars': 1,
  // Jupiter and Saturn only enter through the orthodox selector's daily perfections (orthodox.ts).
  'natal.jupiter': 1, 'natal.saturn': 1,
  'natal.asc': 2, 'natal.mc': 2,
  'transit.mercury': 3, 'transit.venus': 3, 'transit.mars': 3,
};
const CONTACT_ORDER: readonly ContactTarget[] = ['natal.sun', 'natal.moon', 'natal.mercury', 'natal.venus', 'natal.mars',
  'natal.jupiter', 'natal.saturn', 'natal.asc', 'natal.mc', 'transit.mercury', 'transit.venus', 'transit.mars'];
/** Element/modality by tropical sign index (Aries 0 … Pisces 11). */
export const SIGN_ELEMENTS: readonly Element[] = ['fire', 'earth', 'air', 'water', 'fire', 'earth', 'air', 'water', 'fire', 'earth', 'air', 'water'];
/** Moon's essential dignity by tropical sign index (Cancer 3, Taurus 1, Capricorn 9, Scorpio 7). */
export function moonDignity(sign: number): MoonDignity {
  return sign === 3 ? 'domicile' : sign === 1 ? 'exaltation' : sign === 9 ? 'detriment' : sign === 7 ? 'fall' : null;
}
/** Lilly's exception: a void Moon still "somewhat performs" in Taurus, Cancer, Sagittarius or Pisces. */
export const VOID_MITIGATING_SIGNS: readonly number[] = [1, 3, 8, 11];
export const SIGN_MODALITIES: readonly Modality[] = ['cardinal', 'fixed', 'mutable', 'cardinal', 'fixed', 'mutable', 'cardinal', 'fixed', 'mutable', 'cardinal', 'fixed', 'mutable'];
/** Lilly's seven classical bodies minus the Moon itself, used for void-of-course. */
export const VOC_BODIES: readonly number[] = [PLANET_IDS.sun, PLANET_IDS.mercury, PLANET_IDS.venus, PLANET_IDS.mars, SE_JUPITER, SE_SATURN];

export interface Contact {
  target: ContactTarget;
  aspect: AspectName;
  /** Degrees away from exactness at the representative instant. */
  orb: number;
  separation: number;
  /** True when the orb is shrinking at the representative instant (one-minute forward difference). Null for unknown-time natal ranges. */
  applying: boolean | null;
  tier: 1 | 2 | 3;
  /**
   * Waxing when the Moon is past its conjunction with the target and before the opposition
   * (0 < Moon − target < 180°), else waning. Meaningful for sextile, square and trine only.
   */
  side: 'waxing' | 'waning';
  /** Unknown birth time: the natal longitude interval over the civil birth day. */
  natalRange?: [number, number];
}

export interface DayFeatures {
  date: string;
  representative: string;
  julianDayUt: number;
  timeKnown: boolean;
  houseSystem: HouseSystem;
  moon: Position;
  moonSign: number;
  element: Element;
  modality: Modality;
  house: number;
  /** Sun→Moon elongation at the representative instant, 0 ≤ e < 360. */
  elongation: number;
  quarter: Quarter;
  /** Principal phase whose exact instant falls inside this civil day, if any. */
  phaseEvent: PhaseEvent | null;
  voidOfCourse: boolean;
  /** Void of course, but in a sign where Lilly says the Moon still somewhat performs. */
  voidMitigated: boolean;
  /** Essential dignity of the Moon's sign; symbolic strength, used only for the star rating. */
  moonDignity: MoonDignity;
  /** UTC ISO instant at which the Moon enters the next sign. */
  nextIngress: string;
  /** Hours from the representative instant to the next sign ingress. */
  hoursToIngress: number;
  mercuryRetrograde: boolean;
  /** Natal house of the Sun at the representative instant (the month's lit scene). */
  sunHouse: number;
  /** Its axis: houses 1/7 → 1 … 6/12 → 6. */
  sunAxis: number;
  contacts: Contact[];
  primary: Contact | null;
}

function lon(engine: SwissEph, jd: number, body: number): { longitude: number; speed: number } {
  const position = engine.calc(jd, body);
  if (!(position.flags & SEFLG_MOSEPH) || !Number.isFinite(position.longitude)) {
    throw new Error('Configured Moshier ephemeris did not produce a valid position.');
  }
  return { longitude: normalizeDegrees(position.longitude), speed: position.longitudeSpeed };
}

/**
 * Instant (JD UT) at which the Moon next reaches `target` longitude after
 * `jd`, by Newton-style iteration on the Moon's own speed. Converges in a few
 * steps because the Moon never retrogrades and its speed changes slowly.
 */
export function moonReaches(engine: SwissEph, jd: number, target: number): number {
  let t = jd;
  for (let step = 0; step < 12; step++) {
    const moon = lon(engine, t, PLANET_IDS.moon);
    let delta = normalizeDegrees(target - moon.longitude);
    // The first step must move forward; later steps may correct slightly backwards.
    if (step > 0 && delta > 180) delta -= 360;
    if (Math.abs(delta) < 1e-6) return t;
    t += delta / moon.speed;
  }
  return t;
}

/** Relative Moon−planet angles at which one of the five Ptolemaic aspects is exact: each angle and its mirror. */
export const EXACT_RELATIVE_ANGLES: readonly number[] = [...new Set(MAJOR_ASPECTS.flatMap(a => [a.angle, (360 - a.angle) % 360]))]
  .sort((a, b) => a - b);

/**
 * Lilly's definition: the Moon is void of course from its last exact Ptolemaic
 * aspect to a classical planet until it leaves its sign. The Moon outruns every
 * planet, so the relative angle Moon−planet grows monotonically over the hours
 * until ingress; an aspect perfects in (jd, ingress) exactly when that angle
 * crosses one of the exact values. Two planet positions per body suffice.
 */
export function voidOfCourse(engine: SwissEph, jd: number): { void: boolean; ingressJd: number } {
  const moon = lon(engine, jd, PLANET_IDS.moon);
  const signEnd = (Math.floor(moon.longitude / 30) + 1) * 30;
  const ingressJd = moonReaches(engine, jd, normalizeDegrees(signEnd));
  const moonAtIngress = lon(engine, ingressJd, PLANET_IDS.moon).longitude;
  for (const body of VOC_BODIES) {
    const start = normalizeDegrees(moon.longitude - lon(engine, jd, body).longitude);
    let end = normalizeDegrees(moonAtIngress - lon(engine, ingressJd, body).longitude);
    // Unwrap: the span is under 40°, so a smaller end value means one wrap.
    if (end < start) end += 360;
    for (const exact of EXACT_RELATIVE_ANGLES) {
      for (const target of [exact, exact + 360]) {
        // An aspect exact at the ingress instant itself belongs to the next sign.
        if (target > start && target < end) return { void: false, ingressJd };
      }
    }
  }
  return { void: true, ingressJd };
}

export function elongationAt(engine: SwissEph, jd: number): number {
  return normalizeDegrees(lon(engine, jd, PLANET_IDS.moon).longitude - lon(engine, jd, PLANET_IDS.sun).longitude);
}

/** Principal phase whose exact instant lies in [startJd, endJd). Elongation grows monotonically. */
export function phaseEventBetween(engine: SwissEph, startJd: number, endJd: number): PhaseEvent | null {
  const start = elongationAt(engine, startJd);
  const end = elongationAt(engine, endJd);
  const targets: [number, PhaseEvent][] = [[0, 'new'], [90, 'first-quarter'], [180, 'full'], [270, 'last-quarter']];
  for (const [angle, event] of targets) {
    // Crossing test on the circle: the arc from start to end (forward) contains angle.
    const span = normalizeDegrees(end - start);
    const offset = normalizeDegrees(angle - start);
    if (offset < span) return event;
  }
  return null;
}

export function quarterOf(elongation: number): Quarter {
  if (elongation < 90) return 'waxing-crescent';
  if (elongation < 180) return 'waxing-gibbous';
  if (elongation < 270) return 'waning-gibbous';
  return 'waning-crescent';
}

function aspectBetween(separation: number): { aspect: AspectName; orb: number } | null {
  let best: { aspect: AspectName; orb: number } | null = null;
  for (const { name, angle } of MAJOR_ASPECTS) {
    const orb = Math.abs(separation - angle);
    if (orb <= CONTACT_ORB && (!best || orb < best.orb)) best = { aspect: name, orb };
  }
  return best;
}

function sortContacts(contacts: Contact[]): Contact[] {
  // Tier, then tightness, then applying first, then a fixed target order: no randomness.
  return contacts.sort((a, b) => a.tier - b.tier || a.orb - b.orb ||
    Number(b.applying === true) - Number(a.applying === true) ||
    CONTACT_ORDER.indexOf(a.target) - CONTACT_ORDER.indexOf(b.target));
}

export interface FeatureRequest {
  /** Absent only for a chosen sign without birth data (prepareSign). */
  profile?: BirthProfile;
  houseSystem?: HouseSystem;
  timezone: string;
}

/** Natal chart plus, for unknown birth time, the day-long natal planet ranges. */
export interface PreparedNatal {
  natal: NatalChart;
  /** Unknown time only: [start-of-day, end-of-day] natal longitudes of Sun, Mercury, Venus, Mars. */
  ranges: Partial<Record<Exclude<PlanetName, 'moon'>, [number, number]>> | null;
  /** A chosen sign without birth data: no natal planets, so no natal contacts or perfections. */
  signOnly?: true;
}

/**
 * Longitude interval a planet covers during [startJd, endJd], ordered along the
 * zodiac. A planet moves monotonically except on a station day, where the
 * turning point is found by bisecting on the sign of its speed so the extreme
 * longitude is included in the interval.
 */
export function longitudeRangeOverDay(engine: SwissEph, startJd: number, endJd: number, planet: PlanetName | OuterPlanetName): [number, number] {
  const start = planetPosition(engine, startJd, planet);
  const end = planetPosition(engine, endJd, planet);
  const points = [start.longitude, end.longitude];
  // The ephemeris speed and the position minimum disagree by well under an
  // arcsecond; the margin keeps the interval conservative (never too narrow).
  let margin = 0;
  if (Math.sign(start.speed) !== Math.sign(end.speed)) {
    let low = startJd, high = endJd;
    for (let step = 0; step < 40; step++) {
      const middle = (low + high) / 2;
      if (Math.sign(planetPosition(engine, middle, planet).speed) === Math.sign(start.speed)) low = middle; else high = middle;
    }
    points.push(planetPosition(engine, (low + high) / 2, planet).longitude);
    margin = 1e-3;
  }
  // Unwrap around the start position; a day's motion is far below 180°.
  const offsets = points.map(longitude => { const d = longitude - start.longitude; return d > 180 ? d - 360 : d < -180 ? d + 360 : d; });
  return [normalizeDegrees(start.longitude + Math.min(...offsets) - margin), normalizeDegrees(start.longitude + Math.max(...offsets) + margin)];
}

/** A chosen sign as the first house, without birth data (the Kizashi Sora watch face). */
export function prepareSign(sign: number): PreparedNatal {
  return { natal: signNatalChart(sign), ranges: null, signOnly: true };
}

export function prepareNatal(engine: SwissEph, request: FeatureRequest): PreparedNatal {
  if (!request.profile) throw new Error('prepareNatal needs a birth profile; a chosen sign uses prepareSign.');
  const natal = natalChart(engine, request.profile, request.houseSystem ?? 'whole-sign');
  if (natal.timeKnown) return { natal, ranges: null };
  const bounds = dayBounds(request.profile.date, request.profile.timezone);
  const startJd = utcToJulianDay(new Date(bounds.s * 1000));
  // Closed interval: the next midnight itself is included so the last second cannot escape.
  const endJd = utcToJulianDay(new Date(bounds.e * 1000));
  const ranges: PreparedNatal['ranges'] = {};
  for (const planet of ['sun', 'mercury', 'venus', 'mars'] as const) {
    ranges[planet] = longitudeRangeOverDay(engine, startJd, endJd, planet);
  }
  return { natal, ranges };
}

/**
 * Unknown birth time: a contact counts only when the same aspect stays within
 * orb for every possible natal longitude of the civil birth day. Over an arc
 * this short the orb |separation − angle| is V-shaped at worst (its minimum
 * may lie inside, its maximum never does), so checking both ends of the
 * interval — which already includes any station-day extreme — is exact.
 */
/** The Moon's side of its cycle with a target longitude (see Contact.side). */
export function sideOf(moon: number, target: number): 'waxing' | 'waning' {
  const d = normalizeDegrees(moon - target);
  return d > 0 && d < 180 ? 'waxing' : 'waning';
}

function rangeContact(moon: number, target: NatalTarget, range: [number, number]): Contact | null {
  const a = aspectBetween(angularSeparation(moon, range[0]));
  const b = aspectBetween(angularSeparation(moon, range[1]));
  if (!a || !b || a.aspect !== b.aspect) return null;
  return { target, aspect: a.aspect, orb: Math.max(a.orb, b.orb),
    separation: angularSeparation(moon, range[0]), applying: null, tier: 1, side: sideOf(moon, range[0]), natalRange: range };
}

export function dayFeatures(engine: SwissEph, prepared: PreparedNatal, request: FeatureRequest, date: string): DayFeatures {
  const formatter = timezoneFormatter(request.timezone);
  const representative = localDateTimeToUtc(date, '12:00', request.timezone, undefined, formatter);
  const jd = utcToJulianDay(representative);
  const bounds = dayBounds(date, request.timezone, formatter);
  const startJd = utcToJulianDay(new Date(bounds.s * 1000));
  const endJd = utcToJulianDay(new Date(bounds.e * 1000));
  const { natal, ranges } = prepared;
  const moon = planetPosition(engine, jd, 'moon');
  const house = houseOfLongitude(moon.longitude, natal.cusps);
  const elongation = elongationAt(engine, jd);
  const voc = voidOfCourse(engine, jd);
  const mercury = planetPosition(engine, jd, 'mercury');
  const sunHouse = houseOfLongitude(planetPosition(engine, jd, 'sun').longitude, natal.cusps);
  const contacts: Contact[] = [];
  /**
   * Applying = the orb is shrinking at this instant. The orb is
   * |separation − angle|, separation is d or 360−d for the relative angle
   * d = Moon − target, so its derivative follows the relative speed exactly.
   */
  const isApplying = (targetLongitude: number, targetSpeed: number, angle: number) => {
    const d = normalizeDegrees(moon.longitude - targetLongitude);
    const separation = d <= 180 ? d : 360 - d;
    const separationRate = (d <= 180 ? 1 : -1) * (moon.speed - targetSpeed);
    return Math.sign(separation - angle) * separationRate < 0;
  };
  const addContact = (target: ContactTarget, longitude: number, speed: number, allowed?: readonly AspectName[]) => {
    const found = aspectBetween(angularSeparation(moon.longitude, longitude));
    if (!found || (allowed && !allowed.includes(found.aspect))) return;
    const angle = MAJOR_ASPECTS.find(a => a.name === found.aspect)!.angle;
    contacts.push({ target, aspect: found.aspect, orb: found.orb, separation: angularSeparation(moon.longitude, longitude),
      applying: isApplying(longitude, speed, angle), tier: CONTACT_TIER[target], side: sideOf(moon.longitude, longitude) });
  };
  if (natal.timeKnown) {
    for (const planet of ['sun', 'moon', 'mercury', 'venus', 'mars'] as const) {
      addContact(`natal.${planet}`, natal.planets[planet].longitude, 0);
    }
    if (natal.ascendant !== null && natal.midheaven !== null) {
      // Angles only cast conjunction/opposition contacts (ASC/DC, MC/IC).
      addContact('natal.asc', natal.ascendant, 0, ['conjunction', 'opposition']);
      addContact('natal.mc', natal.midheaven, 0, ['conjunction', 'opposition']);
    }
  } else if (ranges) {
    for (const planet of ['sun', 'mercury', 'venus', 'mars'] as const) {
      const contact = rangeContact(moon.longitude, `natal.${planet}`, ranges[planet]!);
      if (contact) contacts.push(contact);
    }
  }
  for (const planet of ['mercury', 'venus', 'mars'] as const) {
    const position = planetPosition(engine, jd, planet);
    addContact(`transit.${planet}`, position.longitude, position.speed);
  }
  sortContacts(contacts);
  const ingress = new Date((voc.ingressJd - 2440587.5) * 86400000);
  return {
    date, representative: representative.toISOString(), julianDayUt: jd,
    timeKnown: natal.timeKnown, houseSystem: natal.houseSystem,
    moon, moonSign: moon.sign, element: SIGN_ELEMENTS[moon.sign], modality: SIGN_MODALITIES[moon.sign], house,
    elongation, quarter: quarterOf(elongation), phaseEvent: phaseEventBetween(engine, startJd, endJd),
    voidOfCourse: voc.void, voidMitigated: voc.void && VOID_MITIGATING_SIGNS.includes(moon.sign),
    moonDignity: moonDignity(moon.sign), nextIngress: ingress.toISOString(), hoursToIngress: (voc.ingressJd - jd) * 24,
    mercuryRetrograde: mercury.speed < 0,
    sunHouse, sunAxis: ((sunHouse - 1) % 6) + 1,
    contacts, primary: contacts[0] ?? null,
  };
}
