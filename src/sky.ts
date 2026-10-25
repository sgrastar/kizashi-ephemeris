/**
 * What one request needs from the sky, computed in one go: the Worker's RPC methods (src/worker.ts) return these
 * as plain data. Each function performs its calculations in the same order the combined Worker did, so an
 * input error is the same one it reported.
 */
import { createEngine, natalChart, signNatalChart, planetPosition, outerPlanetLongitudes, utcToJulianDay, houseOfLongitude, normalizeDegrees, lunarNode } from './ephemeris.js';
import type { BirthProfile, HouseSystem, NatalChart, OuterPlanetLongitudes, Position } from './ephemeris.js';
import { FortuneInputError, addDays, dayBounds, localDateTimeToUtc, timezoneFormatter } from './calendar.js';
import { prepareNatal, prepareSign, dayFeatures, voidOfCourse, elongationAt } from './features.js';
import type { DayFeatures, PhaseEvent, PreparedNatal } from './features.js';
import { orthodoxDay, julianDayToUtc } from './perfections.js';
import type { OrthodoxDay } from './perfections.js';
import { generateWeeklySky } from './weekly-sky.js';
import { searchBestBirths } from './best-births.js';
import { BIRTH_PLACES } from './birth-places.js';
import type { BestBirth, BestBirths, BestBirthsRequest } from './best-births.js';
import type { WeeklySky } from './weekly-sky.js';
import { computeLifeSky } from './life-sky.js';
import { computeJyotishSky } from './jyotish-sky.js';
import type { JyotishSkyRequest, JyotishSky } from './jyotish-types.js';
import type { LifeSkyRequest, LifeSky } from './life-sky.js';

/** The shape of the RPC results; raised when a field changes meaning, not when a calculation is refined. */
export const SKY_SCHEMA_VERSION = 1;

/** An input the calculation cannot accept (an impossible date, a house system undefined at the latitude …). */
export type SkyResult<T> = { ok: true; value: T } | { ok: false; error: { kind: 'input'; message: string; candidates?: number[] } };

function attempt<T>(run: () => T): SkyResult<T> {
  try {
    return { ok: true, value: run() };
  } catch (error) {
    if (error instanceof FortuneInputError) {
      return { ok: false, error: { kind: 'input', message: error.message, ...(error.candidates ? { candidates: error.candidates } : {}) } };
    }
    throw error;
  }
}

type Engine = ReturnType<typeof createEngine>;
function withEngine<T>(run: (engine: Engine) => T): T {
  const engine = createEngine();
  try {
    return run(engine);
  } finally {
    engine.close();
  }
}

// ---- Daily readings (the watch, the site's demo, QA evidence) ----

export interface FortuneSkyRequest {
  /** The birth data; absent when `sign` is given. */
  profile?: BirthProfile;
  /**
   * A chosen sign (0 = Aries … 11 = Pisces) instead of birth data, for the Kizashi Sora watch face:
   * Solar Sign houses from that sign, no natal planets, so no natal contacts or perfections.
   */
  sign?: number;
  houseSystem: HouseSystem;
  /** The display zone the days are civil days in. */
  timezone: string;
  /** The days to read, in order. */
  dates: string[];
  /** Version 4 and later: outer planets at noon and in the birth chart. */
  outer: boolean;
  /** Version 5: the day's features and lunar perfections, from the birth chart prepared again. */
  features: boolean;
}
export interface FortuneSkyDay {
  date: string;
  /** Local noon, the instant the day is read at (ISO). */
  representative: string;
  noon: { sun: Position; moon: Position; mercury: Position; venus: Position; mars: Position };
  outer?: OuterPlanetLongitudes;
  /** UTC seconds: the start and the (exclusive) end of the civil day. */
  s: number;
  e: number;
}
export interface FortuneSky {
  natal: NatalChart;
  /** The birth chart's outer planets; null for an unknown birth time (never invented). */
  outerNatal?: OuterPlanetLongitudes | null;
  days: FortuneSkyDay[];
  prepared?: PreparedNatal;
  features?: { features: DayFeatures; perfections: OrthodoxDay }[];
}

export function fortuneSky(request: FortuneSkyRequest): SkyResult<FortuneSky> {
  return attempt(() => withEngine(engine => {
    const signOnly = request.sign !== undefined;
    if (signOnly === (request.profile !== undefined)) throw new FortuneInputError('出生データか星座のどちらか一方を指定してください。');
    if (signOnly && request.houseSystem !== 'solar-sign') throw new FortuneInputError('星座だけの読みはソーラーサインで指定してください。');
    const formatter = timezoneFormatter(request.timezone);
    const natal = signOnly ? signNatalChart(request.sign!) : natalChart(engine, request.profile!, request.houseSystem);
    const days: FortuneSkyDay[] = request.dates.map(date => {
      // The full day is represented by LOCAL noon, including sign-change days.
      const representative = localDateTimeToUtc(date, '12:00', request.timezone, undefined, formatter);
      const jd = utcToJulianDay(representative);
      const moon = planetPosition(engine, jd, 'moon');
      const noon = { sun: planetPosition(engine, jd, 'sun'), moon, mercury: planetPosition(engine, jd, 'mercury'),
        venus: planetPosition(engine, jd, 'venus'), mars: planetPosition(engine, jd, 'mars') };
      const bounds = dayBounds(date, request.timezone, formatter);
      return { date, representative: representative.toISOString(), noon,
        ...(request.outer ? { outer: outerPlanetLongitudes(engine, jd) } : {}), ...bounds };
    });
    const sky: FortuneSky = { natal, days };
    if (request.outer) sky.outerNatal = natal.timeKnown ? outerPlanetLongitudes(engine, natal.julianDayUt!) : null;
    if (request.features) {
      const featureRequest = { profile: request.profile, houseSystem: request.houseSystem, timezone: request.timezone };
      const prepared = signOnly ? prepareSign(request.sign!) : prepareNatal(engine, featureRequest);
      sky.prepared = prepared;
      sky.features = request.dates.map(date => {
        const features = dayFeatures(engine, prepared, featureRequest, date);
        return { features, perfections: orthodoxDay(engine, prepared, featureRequest, features) };
      });
    }
    return sky;
  }));
}

// ---- One day in detail (the daily e-mail) ----

export interface DaySkyRequest {
  profile: BirthProfile; houseSystem: HouseSystem; timezone: string; date: string; timeline: boolean;
  /** Also the chart extras (ChartSky) for a full birth-chart display. */
  chart?: boolean;
}
/** The ten bodies in a fixed order: Sun, Moon, Mercury, Venus, Mars, Jupiter, Saturn, Uranus, Neptune, Pluto. */
const CHART_BODIES = ['sun', 'moon', 'mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto'] as const;
/**
 * What a full birth-chart display adds: each body's daily motion in longitude (negative while retrograde) and the
 * true lunar node, at birth (null without a birth time) and at the day's representative instant, with the day's
 * longitudes too.
 */
export interface ChartSky {
  natal: { speeds: number[]; node: number } | null;
  today: { longitudes: number[]; speeds: number[]; node: number };
}
export interface DayTimeline {
  voids: { from: string; to: string; fromPreviousDay: boolean; untilNextDay: boolean }[];
  ingress: { at: string; sign: number } | null;
  phase: { at: string; phase: PhaseEvent } | null;
}
export interface DaySky { features: DayFeatures; perfections: OrthodoxDay; timeline?: DayTimeline; chart?: ChartSky }

function chartSky(engine: Engine, natal: NatalChart, todayJd: number): ChartSky {
  const at = (jd: number) => CHART_BODIES.map(body => planetPosition(engine, jd, body));
  const natalJd = natal.timeKnown ? natal.julianDayUt : null;
  const today = at(todayJd);
  return {
    natal: natalJd === null ? null : { speeds: at(natalJd).map(p => p.speed), node: lunarNode(engine, natalJd).longitude },
    today: { longitudes: today.map(p => p.longitude), speeds: today.map(p => p.speed), node: lunarNode(engine, todayJd).longitude },
  };
}

/** Void-of-course stretches inside [startJd, endJd): sampled every 30 minutes, edges found to a minute. */
function voidStretches(engine: Engine, startJd: number, endJd: number) {
  const step = 1 / 48, minute = 1 / 1440;
  const isVoid = (jd: number) => voidOfCourse(engine, jd).void;
  const stretches: { from: number; to: number; fromPreviousDay: boolean; untilNextDay: boolean }[] = [];
  let jd = startJd, inVoid = isVoid(jd), from = inVoid ? startJd : 0;
  while (jd < endJd) {
    const next = Math.min(jd + step, endJd);
    const nextVoid = next < endJd ? isVoid(next) : inVoid;
    if (nextVoid !== inVoid) {
      // Bisect for the change; a void stretch ends at the Moon's ingress.
      let lo = jd, hi = next;
      while (hi - lo > minute) { const mid = (lo + hi) / 2; if (isVoid(mid) === inVoid) lo = mid; else hi = mid; }
      if (inVoid) stretches.push({ from, to: hi, fromPreviousDay: from === startJd, untilNextDay: false });
      else from = hi;
      inVoid = nextVoid;
    }
    jd = next;
  }
  if (inVoid) stretches.push({ from, to: voidOfCourse(engine, endJd - minute).ingressJd, fromPreviousDay: from === startJd, untilNextDay: true });
  return stretches;
}

/** The instant of a principal phase in [startJd, endJd), by bisection on the Sun–Moon elongation. */
function phaseInstant(engine: Engine, startJd: number, endJd: number): { jd: number; phase: PhaseEvent } | null {
  const phases: [number, PhaseEvent][] = [[0, 'new'], [90, 'first-quarter'], [180, 'full'], [270, 'last-quarter']];
  const start = elongationAt(engine, startJd), span = normalizeDegrees(elongationAt(engine, endJd) - start);
  for (const [angle, phase] of phases) {
    if (normalizeDegrees(angle - start) >= span) continue;
    let lo = startJd, hi = endJd;
    while (hi - lo > 1 / 1440) {
      const mid = (lo + hi) / 2;
      if (normalizeDegrees(elongationAt(engine, mid) - start) < normalizeDegrees(angle - start)) lo = mid; else hi = mid;
    }
    return { jd: hi, phase };
  }
  return null;
}

export function daySky(request: DaySkyRequest): SkyResult<DaySky> {
  return attempt(() => withEngine(engine => {
    const featureRequest = { profile: request.profile, houseSystem: request.houseSystem, timezone: request.timezone };
    const prepared = prepareNatal(engine, featureRequest);
    const features = dayFeatures(engine, prepared, featureRequest, request.date);
    const perfections = orthodoxDay(engine, prepared, featureRequest, features);
    const chart = request.chart ? { chart: chartSky(engine, prepared.natal, features.julianDayUt) } : {};
    if (!request.timeline) return { features, perfections, ...chart };
    const bounds = dayBounds(request.date, request.timezone);
    const startJd = utcToJulianDay(new Date(bounds.s * 1000)), endJd = utcToJulianDay(new Date(bounds.e * 1000));
    const voids = voidStretches(engine, startJd, endJd).map(v => ({ from: julianDayToUtc(v.from), to: julianDayToUtc(v.to),
      fromPreviousDay: v.fromPreviousDay, untilNextDay: v.untilNextDay }));
    const ingressJd = voidOfCourse(engine, startJd).ingressJd;
    // The Moon enters the sign after the one it starts the day in.
    const ingress = ingressJd < endJd
      ? { at: julianDayToUtc(ingressJd), sign: (Math.floor(planetPosition(engine, startJd, 'moon').longitude / 30) + 1) % 12 } : null;
    const found = phaseInstant(engine, startJd, endJd);
    return { features, perfections, timeline: { voids, ingress, phase: found ? { at: julianDayToUtc(found.jd), phase: found.phase } : null }, ...chart };
  }));
}

// ---- The website's house-system check ----

export interface QuizSkyRequest {
  profile: BirthProfile;
  timezone: string;
  /** The reader's date; questions look back from the day before. */
  today: string;
  /** In order; the first must be Whole Sign, which every latitude allows. */
  systems: HouseSystem[];
  lookback: number;
  maxDays: number;
  /** The days to compute readings' features for: the question days, or the reader's today. */
  readings: 'questions' | 'today';
}
export interface QuizSky {
  charts: [HouseSystem, NatalChart][];
  /** Systems that cannot be calculated at this birth latitude. */
  excluded: HouseSystem[];
  /** Newest first: days on which the noon Moon's house differs between systems, with each system's house. */
  days: { date: string; houses: [HouseSystem, number][] }[];
  /** For each system and day: the features and perfections, or null when that civil day cannot be read. */
  readings: [HouseSystem, [string, { features: DayFeatures; perfections: OrthodoxDay } | null][]][];
}

export function quizSky(request: QuizSkyRequest): SkyResult<QuizSky> {
  return attempt(() => withEngine(engine => {
    const charts = new Map<HouseSystem, NatalChart>();
    const excluded: HouseSystem[] = [];
    for (const system of request.systems) {
      try {
        charts.set(system, natalChart(engine, request.profile, system));
      } catch (error) {
        // Placidus and Koch are undefined near the poles (Equal is checked the same way); other input errors are the caller's.
        if (error instanceof FortuneInputError && system !== 'whole-sign' && charts.has('whole-sign')) {
          excluded.push(system);
          continue;
        }
        throw error;
      }
    }
    const formatter = timezoneFormatter(request.timezone);
    const days: QuizSky['days'] = [];
    for (let back = 1; back <= request.lookback && days.length < request.maxDays; back++) {
      const date = addDays(request.today, -back);
      const noon = localDateTimeToUtc(date, '12:00', request.timezone, undefined, formatter);
      const moon = planetPosition(engine, utcToJulianDay(noon), 'moon').longitude;
      const houses = [...charts].map(([system, chart]): [HouseSystem, number] => [system, houseOfLongitude(moon, chart.cusps)]);
      if (new Set(houses.map(([, house]) => house)).size > 1) days.push({ date, houses });
    }
    const dates = request.readings === 'today' ? [request.today] : days.map(day => day.date);
    const readings = [...charts.keys()].map(system => {
      const featureRequest = { profile: request.profile, houseSystem: system, timezone: request.timezone };
      const prepared = prepareNatal(engine, featureRequest);
      return [system, dates.map(date => {
        try {
          const features = dayFeatures(engine, prepared, featureRequest, date);
          return [date, { features, perfections: orthodoxDay(engine, prepared, featureRequest, features) }];
        } catch (error) {
          // A civil day the zone cannot resolve (a change at midnight) has no reading; the check goes on.
          if (error instanceof FortuneInputError) return [date, null];
          throw error;
        }
      })];
    }) as QuizSky['readings'];
    return { charts: [...charts], excluded, days, readings };
  }));
}

// ---- The weekly car article ----

export interface WeeklySkyInput { sign: number | string; weekStart?: string }

export function weeklySky(input: WeeklySkyInput, nowMs: number): SkyResult<WeeklySky> {
  return attempt(() => generateWeeklySky(input, new Date(nowMs)));
}

// ---- The births the day's Moon meets best ----

export type { BestBirth, BestBirths, BestBirthsRequest };

/** Seconds of calculation, not milliseconds: a scheduled job's work, not a request's. */
export function bestBirths(request: BestBirthsRequest): SkyResult<BestBirths> {
  return attempt(() => withEngine(engine => searchBestBirths(engine, request)));
}

/** The cities the search is meant to read (src/birth-places.ts), with their names, for a caller that has no copy. */
export function birthPlaces() {
  return BIRTH_PLACES;
}

// ---- The personal page: a life's chart and timing ----

export type { LifeSkyRequest, LifeSky };

/** The natal chart, time lords and long-term astronomical events in one request. */
export function lifeSky(request: LifeSkyRequest): SkyResult<LifeSky> {
  return attempt(() => withEngine(engine => computeLifeSky(engine, request)));
}

// ---- The personal page: Lahiri sidereal timing (separate from lifeSky) ----
export type * from './jyotish-types.js';
export function jyotishSky(request: JyotishSkyRequest): SkyResult<JyotishSky> {
  return attempt(() => withEngine(engine => computeJyotishSky(engine, request)));
}
