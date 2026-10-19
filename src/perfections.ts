/**
 * The day's lunar aspects to the birth chart: every aspect the Moon makes exact to a natal point inside the
 * civil day, with its instant and the Moon's natal house then, and the traditional ruler of each house.
 * Pure calculation; the reading that follows from these lives in the interpretation Worker.
 */
import { SwissEph } from '@typescriptify/sweph/dist/SwissEph/index.js';
import { normalizeDegrees, planetPosition, houseOfLongitude, utcToJulianDay } from './ephemeris.js';
import { dayBounds } from './calendar.js';
import type { AspectName } from './types.js';
import { MAJOR_ASPECTS, CONTACT_TIER, moonReaches, longitudeRangeOverDay } from './features.js';
import type { Contact, ContactTarget, DayFeatures, FeatureRequest, NatalTarget, PreparedNatal } from './features.js';

/** A lunar aspect to a natal point that becomes exact inside the civil day. */
export interface Perfection extends Contact {
  /** UTC ISO instant of exactness (unknown birth time: when the last possible natal longitude is reached). */
  exactAt: string;
  /** Natal house of the Moon at that instant. */
  house: number;
}
export interface OrthodoxDay {
  perfections: Perfection[];
  /** Traditional lord of each natal house 1..12 (index 0 = house 1); null when the birth time is unknown. */
  lords: readonly NatalTarget[] | null;
}

/** Traditional (pre-modern) sign rulers, Aries 0 … Pisces 11 (astrodienst-intro-rulers). */
const TRADITIONAL_RULERS: readonly NatalTarget[] = ['natal.mars', 'natal.venus', 'natal.mercury', 'natal.moon', 'natal.sun',
  'natal.mercury', 'natal.venus', 'natal.mars', 'natal.jupiter', 'natal.saturn', 'natal.saturn', 'natal.jupiter'];
export function houseLords(cusps: readonly number[]): NatalTarget[] {
  return cusps.map(cusp => TRADITIONAL_RULERS[Math.floor(normalizeDegrees(cusp) / 30)]);
}

/** A natal point: a fixed longitude (time known) or the birth-day interval (time unknown), with its allowed aspects. */
interface NatalPoint { target: ContactTarget; longitude: number | [number, number]; aspects: readonly AspectName[] }
const ALL_ASPECTS = MAJOR_ASPECTS.map(a => a.name);
const ANGLE_ASPECTS: readonly AspectName[] = ['conjunction', 'opposition'];

function natalPoints(engine: SwissEph, prepared: PreparedNatal, request: FeatureRequest): NatalPoint[] {
  // A chosen sign without birth data has no natal points to perfect.
  if (prepared.signOnly) return [];
  const chart = prepared.natal;
  if (chart.timeKnown) {
    const jd = chart.julianDayUt!;
    const points: NatalPoint[] = (['sun', 'moon', 'mercury', 'venus', 'mars'] as const)
      .map(p => ({ target: `natal.${p}` as NatalTarget, longitude: chart.planets![p].longitude, aspects: ALL_ASPECTS }));
    for (const p of ['jupiter', 'saturn'] as const) points.push({ target: `natal.${p}`, longitude: planetPosition(engine, jd, p).longitude, aspects: ALL_ASPECTS });
    if (chart.ascendant !== null && chart.midheaven !== null) {
      points.push({ target: 'natal.asc', longitude: chart.ascendant, aspects: ANGLE_ASPECTS },
        { target: 'natal.mc', longitude: chart.midheaven, aspects: ANGLE_ASPECTS });
    }
    return points;
  }
  // Unknown time: same certainty rule as the noon contacts — never the natal Moon or angles.
  const bounds = dayBounds(request.profile!.date, request.profile!.timezone);
  const startJd = utcToJulianDay(new Date(bounds.s * 1000)), endJd = utcToJulianDay(new Date(bounds.e * 1000));
  const points: NatalPoint[] = (['sun', 'mercury', 'venus', 'mars'] as const)
    .map(p => ({ target: `natal.${p}` as NatalTarget, longitude: prepared.ranges![p]!, aspects: ALL_ASPECTS }));
  for (const p of ['jupiter', 'saturn'] as const) points.push({ target: `natal.${p}`, longitude: longitudeRangeOverDay(engine, startJd, endJd, p), aspects: ALL_ASPECTS });
  return points;
}

/** JD (UT) back to a UTC instant through the ephemeris' own time scale, the inverse of utcToJulianDay. */
export function julianDayToUtc(jd: number): string {
  const t = SwissEph.jdUtToUtc(jd);
  return new Date(Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute) + Math.round(t.second * 1000)).toISOString();
}

/** Every lunar aspect to a natal point that becomes exact in [day start, day end), in time order. */
export function orthodoxDay(engine: SwissEph, prepared: PreparedNatal, request: FeatureRequest, f: DayFeatures): OrthodoxDay {
  const bounds = dayBounds(f.date, request.timezone);
  const startJd = utcToJulianDay(new Date(bounds.s * 1000)), endJd = utcToJulianDay(new Date(bounds.e * 1000));
  const start = planetPosition(engine, startJd, 'moon').longitude;
  const span = normalizeDegrees(planetPosition(engine, endJd, 'moon').longitude - start);
  // Forward arc offset of a longitude from the day's starting Moon; inside the day when below the span.
  const within = (longitude: number) => normalizeDegrees(longitude - start) < span;
  const cusps = prepared.natal.cusps;
  const perfections: Perfection[] = [];
  for (const point of natalPoints(engine, prepared, request)) {
    for (const aspect of point.aspects) {
      const angle = MAJOR_ASPECTS.find(a => a.name === aspect)!.angle;
      for (const offset of angle === 0 || angle === 180 ? [angle] : [angle, 360 - angle]) {
        const ends = typeof point.longitude === 'number' ? [point.longitude] : point.longitude;
        const targets = ends.map(l => normalizeDegrees(l + offset));
        if (!targets.every(within)) continue;
        // The last natal possibility to perfect decides the instant (only one end when the time is known).
        const last = targets.reduce((a, b) => normalizeDegrees(a - start) >= normalizeDegrees(b - start) ? a : b);
        const jd = moonReaches(engine, startJd, last);
        // The crossing was decided on longitudes; keep the reported instant inside the half-open day
        // despite the iteration tolerance and millisecond rounding.
        const exactMs = Math.min(Math.max(Date.parse(julianDayToUtc(jd)), bounds.s * 1000), bounds.e * 1000 - 1);
        perfections.push({
          target: point.target, aspect, orb: 0, separation: angle, applying: true, tier: CONTACT_TIER[point.target],
          // Moon = natal + angle is after the conjunction (waxing); natal + (360 − angle) is waning.
          side: offset > 0 && offset < 180 ? 'waxing' : 'waning',
          ...(typeof point.longitude === 'number' ? {} : { natalRange: point.longitude }),
          exactAt: new Date(exactMs).toISOString(), house: houseOfLongitude(last, cusps),
        });
      }
    }
  }
  perfections.sort((a, b) => a.exactAt.localeCompare(b.exactAt) || a.target.localeCompare(b.target, 'en'));
  return { perfections, lords: prepared.natal.timeKnown ? houseLords(cusps) : null };
}

