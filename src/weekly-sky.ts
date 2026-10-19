import {
  angularSeparation, createEngine, normalizeDegrees, planetPosition, utcToJulianDay, wholeSignHouse,
} from './ephemeris.js';
import type { Position } from './ephemeris.js';
import { addDays, FortuneInputError, localDateTimeToUtc, parseDate, timezoneFormatter } from './calendar.js';

export const WEEKLY_TIMEZONE = 'Asia/Tokyo';
export const WEEKLY_SIGNS = [
  { index: 0, id: 'aries', label: '牡羊座' }, { index: 1, id: 'taurus', label: '牡牛座' },
  { index: 2, id: 'gemini', label: '双子座' }, { index: 3, id: 'cancer', label: '蟹座' },
  { index: 4, id: 'leo', label: '獅子座' }, { index: 5, id: 'virgo', label: '乙女座' },
  { index: 6, id: 'libra', label: '天秤座' }, { index: 7, id: 'scorpio', label: '蠍座' },
  { index: 8, id: 'sagittarius', label: '射手座' }, { index: 9, id: 'capricorn', label: '山羊座' },
  { index: 10, id: 'aquarius', label: '水瓶座' }, { index: 11, id: 'pisces', label: '魚座' },
] as const;
export type WeeklySign = typeof WEEKLY_SIGNS[number];
export type WeeklyPlanetName = 'sun' | 'moon' | 'mercury' | 'venus' | 'mars' | 'jupiter' | 'saturn';
export type WeeklyAspectName = 'conjunction' | 'sextile' | 'square' | 'trine' | 'opposition';
export type WeeklyLunarPhase = 'new-moon' | 'first-quarter' | 'full-moon' | 'last-quarter';

const PLANETS: readonly { planet: WeeklyPlanetName; label: string }[] = [
  { planet: 'sun', label: '太陽' }, { planet: 'moon', label: '月' },
  { planet: 'mercury', label: '水星' }, { planet: 'venus', label: '金星' },
  { planet: 'mars', label: '火星' }, { planet: 'jupiter', label: '木星' },
  { planet: 'saturn', label: '土星' },
];
const ASPECTS: readonly { aspect: WeeklyAspectName; label: string; angle: number }[] = [
  { aspect: 'conjunction', label: '合', angle: 0 }, { aspect: 'sextile', label: '六分', angle: 60 },
  { aspect: 'square', label: '矩', angle: 90 }, { aspect: 'trine', label: '三分', angle: 120 },
  { aspect: 'opposition', label: '衝', angle: 180 },
];
const PHASES: readonly { phase: WeeklyLunarPhase; label: string; angle: number }[] = [
  { phase: 'new-moon', label: '新月', angle: 0 }, { phase: 'first-quarter', label: '上弦', angle: 90 },
  { phase: 'full-moon', label: '満月', angle: 180 }, { phase: 'last-quarter', label: '下弦', angle: 270 },
];
const SAMPLE_SECONDS = 6 * 3600;
const ASPECT_ORB = 3;
const SPEED_HALF_SPAN_SECONDS = 600;
const SPEED_HALF_SPAN_DAYS = SPEED_HALF_SPAN_SECONDS / 86400;
const CALCULATION_VERSION = 'typescriptify-1.0.4-moshier-tropical-weekly-solar-sign-3';

export interface WeeklyPlanet extends Position {
  planet: WeeklyPlanetName;
  label: string;
  signLabel: string;
  retrograde: boolean;
  /** Whole sign house with the selected zodiac sign as house 1; no birth chart. */
  house: number;
}
export interface WeeklyAspect {
  id: string;
  planets: [WeeklyPlanetName, WeeklyPlanetName];
  aspect: WeeklyAspectName;
  label: string;
  angle: number;
  orb: number;
  /** Instantaneous direction of the orb at this snapshot, using calculated speeds. */
  applying: boolean;
}
interface WeeklyEventBase {
  id: string;
  at: string;
  date: string;
}
export interface WeeklyIngressEvent extends WeeklyEventBase {
  type: 'sign-ingress';
  planet: WeeklyPlanetName;
  label: string;
  fromSign: number;
  fromSignLabel: string;
  toSign: number;
  toSignLabel: string;
  direction: 'direct' | 'retrograde';
  longitude: number;
}
export interface WeeklyPhaseEvent extends WeeklyEventBase {
  type: 'lunar-phase';
  phase: WeeklyLunarPhase;
  label: string;
  angle: number;
  sunLongitude: number;
  moonLongitude: number;
}
export interface WeeklyStationEvent extends WeeklyEventBase {
  type: 'station';
  planet: WeeklyPlanetName;
  label: string;
  direction: 'direct' | 'retrograde';
  longitude: number;
  sign: number;
  signLabel: string;
}
export interface WeeklyTransitAspectEvent extends WeeklyEventBase {
  type: 'transit-aspect';
  planets: [WeeklyPlanetName, WeeklyPlanetName];
  aspect: WeeklyAspectName;
  /** Planet pair plus aspect name, for an audience-independent event label. */
  label: string;
  angle: number;
  separation: number;
  /** Residual at the integer-second root; not an ephemeris accuracy estimate. */
  orb: number;
  longitudeA: number;
  longitudeB: number;
}
export type WeeklyEvent = WeeklyIngressEvent | WeeklyPhaseEvent | WeeklyStationEvent | WeeklyTransitAspectEvent;
export interface WeeklySky {
  schemaVersion: 1;
  calculationVersion: string;
  zodiac: 'tropical';
  houseSystem: 'solar-sign';
  sign: WeeklySign;
  period: {
    startDate: string;
    endDate: string;
    endExclusiveDate: string;
    timezone: typeof WEEKLY_TIMEZONE;
    startAt: string;
    endAt: string;
  };
  calculationScope: {
    ephemeris: 'moshier';
    snapshotLocalTime: '12:00';
    aspectOrbDegrees: 3;
    eventSampleHours: 6;
    /** Numerical search precision, not an astronomical accuracy claim. */
    eventSearchToleranceSeconds: 1;
    /** The translated ephemeris still has observable deviations from native Swiss Ephemeris. */
    eventTimeAccuracy: 'prototype-ephemeris-not-guaranteed';
    longitudeSpeedMethod: 'central-difference';
    speedDifferenceHalfSpanSeconds: 600;
    events: ['sign-ingress', 'lunar-phase', 'station', 'transit-aspect'];
    /** Exact crossings of the five major aspects for the seven included bodies. */
    exactTransitAspects: true;
  };
  days: { date: string; at: string; planets: WeeklyPlanet[]; aspects: WeeklyAspect[] }[];
  events: WeeklyEvent[];
}

/** Accept 0-based indices, English IDs, and canonical Japanese names. */
export function normalizeWeeklySign(value: number | string): number {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < 12) return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    const aliases: Readonly<Record<string, number>> = {
      おひつじ座: 0, おうし座: 1, ふたご座: 2, かに座: 3, しし座: 4, おとめ座: 5,
      てんびん座: 6, さそり座: 7, いて座: 8, やぎ座: 9, みずがめ座: 10, うお座: 11,
    };
    const sign = WEEKLY_SIGNS.find(candidate => candidate.id === normalized || candidate.label === normalized);
    if (sign) return sign.index;
    if (Object.hasOwn(aliases, normalized)) return aliases[normalized];
    if (/^(?:[0-9]|1[01])$/.test(normalized)) return Number(normalized);
  }
  throw new FortuneInputError('星座は 0 から 11 の整数、英語の星座 ID、または日本語の星座名で指定してください。');
}

function civilDate(instant: Date, formatter = timezoneFormatter(WEEKLY_TIMEZONE)): string {
  const parts = Object.fromEntries(formatter.formatToParts(instant).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** Monday containing now in JST, including Sunday UTC / Monday JST rollover. */
export function currentWeekStart(now = new Date()): string {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new FortuneInputError('現在日時が不正です。');
  const today = civilDate(now);
  const { year, month, day } = parseDate(today);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return addDays(today, -((weekday + 6) % 7));
}

function signedDelta(from: number, to: number): number {
  return normalizeDegrees(to - from + 180) - 180;
}

/** Integer-second search matches utcToJulianDay's UTC input precision. */
function firstCrossingSecond(left: number, right: number, crossed: (second: number) => boolean): number {
  if (crossed(left)) return left;
  for (let iteration = 0; right - left > 1 && iteration < 32; iteration++) {
    const middle = Math.floor((left + right) / 2);
    if (crossed(middle)) right = middle;
    else left = middle;
  }
  return right;
}

type SkyPositions = Record<WeeklyPlanetName, Position>;

function snapshotAspects(date: string, positions: SkyPositions): WeeklyAspect[] {
  const aspects: WeeklyAspect[] = [];
  for (let a = 0; a < PLANETS.length; a++) for (let b = a + 1; b < PLANETS.length; b++) {
    const planetA = PLANETS[a].planet;
    const planetB = PLANETS[b].planet;
    const first = positions[planetA];
    const second = positions[planetB];
    const separation = angularSeparation(first.longitude, second.longitude);
    for (const aspect of ASPECTS) {
      const orb = Math.abs(separation - aspect.angle);
      if (orb > ASPECT_ORB) continue;
      // Shortest signed angle's derivative determines whether its distance
      // from the target is shrinking. At exactness applying is false.
      const signed = signedDelta(first.longitude, second.longitude);
      const separationSpeed = Math.sign(signed) * (second.speed - first.speed);
      aspects.push({
        id: `${date}:${planetA}:${planetB}:${aspect.aspect}`, planets: [planetA, planetB],
        ...aspect, orb, applying: (separation - aspect.angle) * separationSpeed < 0,
      });
    }
  }
  return aspects;
}

/** Calculate sky facts only. All interpretation, ratings and lucky items belong to the authoring step. */
export function generateWeeklySky(
  input: { sign: number | string; weekStart?: string }, now = new Date(),
): WeeklySky {
  if (!input || typeof input !== 'object') throw new FortuneInputError('星座を指定してください。');
  const sign = WEEKLY_SIGNS[normalizeWeeklySign(input.sign)];
  const startDate = input.weekStart === undefined ? currentWeekStart(now) : input.weekStart;
  const { year, month, day } = parseDate(startDate);
  if (new Date(Date.UTC(year, month - 1, day)).getUTCDay() !== 1) {
    throw new FortuneInputError('週間の開始日は月曜日で指定してください。');
  }
  const endDate = addDays(startDate, 6);
  const endExclusiveDate = addDays(startDate, 7);
  const formatter = timezoneFormatter(WEEKLY_TIMEZONE);
  const start = localDateTimeToUtc(startDate, '00:00', WEEKLY_TIMEZONE, undefined, formatter);
  const end = localDateTimeToUtc(endExclusiveDate, '00:00', WEEKLY_TIMEZONE, undefined, formatter);
  const startSecond = start.getTime() / 1000;
  const endSecond = end.getTime() / 1000;
  const engine = createEngine();
  const cache = new Map<number, SkyPositions>();
  // Exact-aspect bisection needs only two longitudes. Avoid calculating all
  // seven bodies and their speed derivatives at every refinement instant.
  const longitudeCache = new Map<number, Map<WeeklyPlanetName, Position>>();
  const positionAt = (second: number, planet: WeeklyPlanetName): Position => {
    let instant = longitudeCache.get(second);
    if (!instant) { instant = new Map(); longitudeCache.set(second, instant); }
    const existing = instant.get(planet);
    if (existing) return existing;
    const position = planetPosition(engine, utcToJulianDay(new Date(second * 1000)), planet);
    instant.set(planet, position);
    return position;
  };
  const positionsAt = (second: number): SkyPositions => {
    const existing = cache.get(second);
    if (existing) return existing;
    const jd = utcToJulianDay(new Date(second * 1000));
    const positions = Object.fromEntries(PLANETS.map(({ planet }) => {
      const position = positionAt(second, planet);
      // The TS port's reported longitudeSpeed is inconsistent with its own
      // apparent longitude, moving some station events across the JST week
      // boundary. Use the same longitude model for every weekly motion fact.
      // A symmetric 20-minute span is stable near slow-planet stations and
      // unwraps the zodiac crossing before taking degrees per day.
      const before = planetPosition(engine, jd - SPEED_HALF_SPAN_DAYS, planet).longitude;
      const after = planetPosition(engine, jd + SPEED_HALF_SPAN_DAYS, planet).longitude;
      const speed = signedDelta(before, after) / (2 * SPEED_HALF_SPAN_DAYS);
      return [planet, { ...position, speed }];
    })) as SkyPositions;
    cache.set(second, positions);
    return positions;
  };
  try {
    const days = Array.from({ length: 7 }, (_, index) => {
      const date = addDays(startDate, index);
      const instant = localDateTimeToUtc(date, '12:00', WEEKLY_TIMEZONE, undefined, formatter);
      const positions = positionsAt(instant.getTime() / 1000);
      return {
        date, at: instant.toISOString(),
        planets: PLANETS.map(({ planet, label }) => {
          const position = positions[planet];
          return { planet, label, ...position, signLabel: WEEKLY_SIGNS[position.sign].label,
            retrograde: position.speed < 0, house: wholeSignHouse(position.longitude, sign.index * 30) };
        }),
        aspects: snapshotAspects(date, positions),
      };
    });
    const events: WeeklyEvent[] = [];
    const eventBase = (second: number, kind: string): WeeklyEventBase => {
      const instant = new Date(second * 1000);
      const at = instant.toISOString();
      return { id: `${kind}:${at}`, at, date: civilDate(instant, formatter) };
    };
    const inWeek = (second: number) => second >= startSecond && second < endSecond;
    // Include a preceding bracket so an event exactly at Monday midnight is
    // included. The end instant is sampled for bracketing but is never emitted.
    for (let leftSecond = startSecond - SAMPLE_SECONDS; leftSecond < endSecond; leftSecond += SAMPLE_SECONDS) {
      const rightSecond = Math.min(leftSecond + SAMPLE_SECONDS, endSecond);
      const left = positionsAt(leftSecond);
      const right = positionsAt(rightSecond);
      for (const { planet, label } of PLANETS) {
        const a = left[planet];
        const b = right[planet];
        if (a.sign !== b.sign) {
          const delta = signedDelta(a.longitude, b.longitude);
          const direct = delta > 0;
          const target = direct ? (Math.floor(a.longitude / 30) + 1) * 30 : Math.floor(a.longitude / 30) * 30;
          const unwrappedAt = (second: number) => a.longitude + signedDelta(a.longitude, positionsAt(second)[planet].longitude);
          const second = firstCrossingSecond(leftSecond, rightSecond,
            time => direct ? unwrappedAt(time) >= target : unwrappedAt(time) < target);
          if (inWeek(second)) events.push({
            ...eventBase(second, `sign-ingress:${planet}`), type: 'sign-ingress', planet, label,
            fromSign: a.sign, fromSignLabel: WEEKLY_SIGNS[a.sign].label,
            toSign: b.sign, toSignLabel: WEEKLY_SIGNS[b.sign].label,
            direction: direct ? 'direct' : 'retrograde', longitude: normalizeDegrees(target),
          });
        }
        if ((a.speed < 0) !== (b.speed < 0)) {
          const retrograde = b.speed < 0;
          const second = firstCrossingSecond(leftSecond, rightSecond,
            time => (positionsAt(time)[planet].speed < 0) === retrograde);
          const position = positionsAt(second)[planet];
          if (inWeek(second)) events.push({
            ...eventBase(second, `station:${planet}`), type: 'station', planet, label,
            direction: retrograde ? 'retrograde' : 'direct', longitude: position.longitude,
            sign: position.sign, signLabel: WEEKLY_SIGNS[position.sign].label,
          });
        }
      }
      const phaseLeft = normalizeDegrees(left.moon.longitude - left.sun.longitude);
      const phaseRight = phaseLeft + signedDelta(phaseLeft, normalizeDegrees(right.moon.longitude - right.sun.longitude));
      for (const phase of PHASES) {
        const target = phase.angle + (phase.angle <= phaseLeft ? 360 : 0);
        if (target > phaseRight) continue;
        const second = firstCrossingSecond(leftSecond, rightSecond, time => {
          const positions = positionsAt(time);
          const angle = normalizeDegrees(positions.moon.longitude - positions.sun.longitude);
          return phaseLeft + signedDelta(phaseLeft, angle) >= target;
        });
        const positions = positionsAt(second);
        if (inWeek(second)) events.push({
          ...eventBase(second, `lunar-phase:${phase.phase}`), type: 'lunar-phase', ...phase,
          sunLongitude: positions.sun.longitude, moonLongitude: positions.moon.longitude,
        });
      }
      for (let a = 0; a < PLANETS.length; a++) for (let b = a + 1; b < PLANETS.length; b++) {
        const planetA = PLANETS[a].planet;
        const planetB = PLANETS[b].planet;
        const relativeAngleAt = (second: number) => normalizeDegrees(
          positionAt(second, planetB).longitude - positionAt(second, planetA).longitude);
        const relativeSpeedAt = (second: number) => {
          const positions = positionsAt(second);
          return positions[planetB].speed - positions[planetA].speed;
        };
        const leftSpeed = left[planetB].speed - left[planetA].speed;
        const rightSpeed = right[planetB].speed - right[planetA].speed;
        const brackets = [leftSecond, rightSecond];
        // A relative-motion turn can cross the same aspect twice in one
        // bracket. Split there, using longitude-derived speed as for stations.
        if ((leftSpeed < 0) !== (rightSpeed < 0)) {
          const decreasing = rightSpeed < 0;
          const turn = firstCrossingSecond(leftSecond, rightSecond,
            second => (relativeSpeedAt(second) < 0) === decreasing);
          if (turn > leftSecond && turn < rightSecond) brackets.splice(1, 0, turn);
        }
        for (let interval = 0; interval < brackets.length - 1; interval++) {
          const from = brackets[interval];
          const to = brackets[interval + 1];
          const angleFrom = relativeAngleAt(from);
          const angleTo = angleFrom + signedDelta(angleFrom, relativeAngleAt(to));
          const increasing = angleTo > angleFrom;
          if (angleTo === angleFrom) continue;
          for (const aspect of ASPECTS) {
            // Sextiles, squares and trines have two oriented relative angles.
            // Conjunction and opposition each have only one distinct angle.
            const oriented = aspect.angle === 0 || aspect.angle === 180 ? [aspect.angle] : [aspect.angle, 360 - aspect.angle];
            for (const targetAngle of oriented) {
              const target = increasing ? targetAngle + Math.ceil((angleFrom - targetAngle) / 360) * 360 :
                targetAngle + Math.floor((angleFrom - targetAngle) / 360) * 360;
              // Strict at the left endpoint, inclusive at the right endpoint:
              // adjacent brackets emit an exact crossing only once. The
              // preceding bracket includes an event at the week's first second.
              if (increasing ? target <= angleFrom || target > angleTo : target >= angleFrom || target < angleTo) continue;
              const second = firstCrossingSecond(from, to, time => {
                const angle = angleFrom + signedDelta(angleFrom, relativeAngleAt(time));
                return increasing ? angle >= target : angle <= target;
              });
              if (!inWeek(second)) continue;
              const longitudeA = positionAt(second, planetA).longitude;
              const longitudeB = positionAt(second, planetB).longitude;
              const separation = angularSeparation(longitudeA, longitudeB);
              events.push({
                ...eventBase(second, `transit-aspect:${planetA}:${planetB}:${aspect.aspect}`),
                type: 'transit-aspect', planets: [planetA, planetB], aspect: aspect.aspect,
                label: `${PLANETS[a].label}・${PLANETS[b].label} ${aspect.label}`,
                angle: aspect.angle, separation, orb: Math.abs(separation - aspect.angle), longitudeA, longitudeB,
              });
            }
          }
        }
      }
    }
    events.sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
    return {
      schemaVersion: 1, calculationVersion: CALCULATION_VERSION, zodiac: 'tropical', houseSystem: 'solar-sign', sign,
      period: { startDate, endDate, endExclusiveDate, timezone: WEEKLY_TIMEZONE, startAt: start.toISOString(), endAt: end.toISOString() },
      calculationScope: { ephemeris: 'moshier', snapshotLocalTime: '12:00', aspectOrbDegrees: 3,
        eventSampleHours: 6, eventSearchToleranceSeconds: 1, eventTimeAccuracy: 'prototype-ephemeris-not-guaranteed',
        longitudeSpeedMethod: 'central-difference', speedDifferenceHalfSpanSeconds: SPEED_HALF_SPAN_SECONDS,
        events: ['sign-ingress', 'lunar-phase', 'station', 'transit-aspect'], exactTransitAspects: true },
      days, events,
    };
  } finally {
    engine.close();
  }
}
