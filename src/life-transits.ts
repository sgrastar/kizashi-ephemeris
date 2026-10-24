/** Shared longitude searches for the life chart; each sampling grid is reused across natal targets. */
import type { SwissEph } from '@typescriptify/sweph/dist/SwissEph/index.js';
import { normalizeDegrees, houseOfLongitude, angularSeparation, PLANET_IDS, OUTER_PLANET_IDS } from './ephemeris.js';
import type { PlanetName } from './types.js';
import type { OuterPlanetName } from './ephemeris.js';
import { julianDayToUtc } from './perfections.js';
import { MAJOR_ASPECTS } from './features.js';
import { sweCalcUt } from '@typescriptify/sweph/dist/sweph.js';
import { SEFLG_MOSEPH } from '@typescriptify/sweph/dist/constants.js';
import { TROPICAL_YEAR_DAYS } from './time-lords.js';

export const LIFE_BODIES = ['sun', 'moon', 'mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto'] as const;
export type LifeBody = PlanetName | OuterPlanetName;
export interface LifePoint { point: string; longitude: number }
/**
 * One continuous stretch inside the orb. `angle` is the moving body's longitude minus the point's at exactness:
 * 0, 180, or ±60/±90/±120, so +90 is the waxing (first) square and -90 the waning one.
 */
export interface ContactWindow<Body extends string = LifeBody> { body: Body; point: string; aspect: string; angle: number; enter: string; exact: string[]; leave: string }
export interface Ingress { body: LifeBody; at: string; sign: number; house: number; retrograde: boolean }
export interface Station { body: LifeBody; at: string; kind: 'retrograde' | 'direct'; longitude: number; house: number }
export const rounded = (value: number, digits = 4) => Number(value.toFixed(digits));
export const longitude4 = (value: number) => { const result = rounded(normalizeDegrees(value)); return result === 360 ? 0 : result; };
export const lifeIso = (jd: number) => new Date(Math.round(Date.parse(julianDayToUtc(jd)) / 1000) * 1000).toISOString().replace('.000Z', 'Z');
export const delta = (from: number, to: number) => normalizeDegrees(to - from + 180) - 180;
const SECOND = 1 / 86400;
interface Sample { jd: number; lon: number }
export interface Path { start: number; end: number; step: number; at: (jd: number) => number; nodes: Sample[]; turns: number[] }

const IDS = { ...PLANET_IDS, ...OUTER_PLANET_IDS };
/** Search longitude without calculating unused speed vectors; natal and snapshot speeds keep their existing path. */
export function longitudeAt(engine: SwissEph, jd: number, body: LifeBody): number {
  const position = sweCalcUt(engine.swed, jd, IDS[body], SEFLG_MOSEPH);
  if (position.flags < 0 || !(position.flags & SEFLG_MOSEPH) || !Number.isFinite(position.xx[0])) throw new Error('Invalid Moshier search longitude.');
  return normalizeDegrees(position.xx[0]);
}
const phaseAt = (engine: SwissEph, jd: number) => normalizeDegrees(longitudeAt(engine, jd, 'moon') - longitudeAt(engine, jd, 'sun'));

/** The first second after a monotone crossing; precision describes the search, not the ephemeris. */
export function crossing(left: number, right: number, crossed: (jd: number) => boolean): number {
  if (crossed(left)) return left;
  while (right - left > SECOND) {
    const mid = (left + right) / 2;
    if (crossed(mid)) right = mid; else left = mid;
  }
  return right;
}

/** Central difference of longitude over ±10 minutes, including at stations. */
export function motion(at: (jd: number) => number, jd: number): number {
  return delta(at(jd - 1 / 144), at(jd + 1 / 144)) * 72;
}

/** Cache one body's positions and insert refined turning points into its grid. */
export function longitudePath(at: (jd: number) => number, start: number, end: number, step: number, stations = false): Path {
  const cache = new Map<number, number>();
  const cached = (jd: number) => {
    let lon = cache.get(jd);
    if (lon === undefined) { lon = normalizeDegrees(at(jd)); cache.set(jd, lon); }
    return lon;
  };
  const nodes: Sample[] = [];
  for (let jd = start; jd < end; jd += step) nodes.push({ jd, lon: cached(jd) });
  nodes.push({ jd: end, lon: cached(end) });
  const turns: number[] = [];
  if (stations) {
    for (let i = 1; i < nodes.length - 1; i++) {
      const before = delta(nodes[i - 1].lon, nodes[i].lon), after = delta(nodes[i].lon, nodes[i + 1].lon);
      if (before * after > 0) continue;
      const a = nodes[i - 1].jd, b = nodes[i + 1].jd;
      const negative = motion(cached, a) < 0;
      if (negative === (motion(cached, b) < 0)) continue;
      const jd = crossing(a, b, t => (motion(cached, t) < 0) !== negative);
      if (!turns.some(t => Math.abs(jd - t) < 2 * SECOND)) turns.push(jd);
    }
    // At a window edge a turn can precede the first full grid segment.
    for (const [a, b] of [[start, Math.min(end, start + step)], [Math.max(start, end - step), end]]) {
      const negative = motion(cached, a) < 0;
      if (negative !== (motion(cached, b) < 0)) {
        const jd = crossing(a, b, t => (motion(cached, t) < 0) !== negative);
        if (!turns.some(t => Math.abs(jd - t) < 2 * SECOND)) turns.push(jd);
      }
    }
    nodes.push(...turns.map(jd => ({ jd, lon: cached(jd) })));
    nodes.sort((a, b) => a.jd - b.jd);
  }
  return { start, end, step, at: cached, nodes, turns };
}

/** Sample bodies at the same instant together, sharing the engine's Earth and reference-frame caches. */
export function bodyPaths(engine: SwissEph, bodies: readonly LifeBody[], start: number, end: number, step: number) {
  const grids = bodies.map(() => new Map<number, number>());
  const sample = (jd: number) => bodies.forEach((body, i) => grids[i].set(jd, longitudeAt(engine, jd, body)));
  for (let jd = start; jd < end; jd += step) sample(jd);
  sample(end);
  return bodies.map((body, i) => ({ body,
    path: longitudePath(jd => grids[i].get(jd) ?? longitudeAt(engine, jd, body), start, end, step, body !== 'sun') }));
}

/** All oriented target crossings, including windows narrower than one grid step. */
export function crossings(path: Path, targets: readonly number[]): { jd: number; target: number }[] {
  const events: { jd: number; target: number }[] = [];
  const last = new Map<number, number>();
  for (let i = 1; i < path.nodes.length; i++) {
    const a = path.nodes[i - 1], b = path.nodes[i], span = delta(a.lon, b.lon);
    if (!span) continue;
    for (const target of targets) {
      const offset = delta(a.lon, target);
      if (span > 0 ? offset < 0 || offset > span : offset > 0 || offset < span) continue;
      // Keep exact nodes (including the search start) and emit a shared node only once.
      const jd = offset === 0 ? a.jd : offset === span ? b.jd :
        crossing(a.jd, b.jd, t => span > 0 ? delta(a.lon, path.at(t)) >= offset : delta(a.lon, path.at(t)) <= offset);
      if (last.get(target) === jd) continue;
      last.set(target, jd);
      events.push({ jd, target });
    }
  }
  return events.sort((a, b) => a.jd - b.jd);
}

function edge(path: Path, target: number, orb: number, direction: -1 | 1) {
  let cursor = direction < 0 ? path.start : path.end;
  const exact: number[] = [];
  // Extend only open windows. Slow-planet orb boundaries can be years outside the requested range.
  for (let n = 0; n < 10000; n++) {
    const next = cursor + direction * path.step * 16;
    const extra = longitudePath(path.at, Math.min(cursor, next), Math.max(cursor, next), path.step, true);
    const hits = crossings(extra, [target, normalizeDegrees(target - orb), normalizeDegrees(target + orb)]);
    if (direction < 0) hits.reverse();
    for (const hit of hits) {
      if (angularSeparation(hit.target, target) < 1e-7) exact.push(hit.jd);
      else if (angularSeparation(path.at(hit.jd + direction * 2 * SECOND), target) > orb) return { jd: hit.jd, exact };
    }
    cursor = next;
  }
  throw new Error('An orb boundary could not be found.');
}

/** Continuous orb windows; exact passages in a retrograde loop stay in the same window. */
export function contactWindows<Body extends string>(path: Path, body: Body, points: readonly LifePoint[], orb: number,
  aspects: readonly { name: string; angle: number }[] = MAJOR_ASPECTS): ContactWindow<Body>[] {
  const result: ContactWindow<Body>[] = [];
  for (const point of points) for (const aspect of aspects) {
    for (const angle of aspect.angle === 0 || aspect.angle === 180 ? [aspect.angle] : [aspect.angle, -aspect.angle]) {
      const target = normalizeDegrees(point.longitude + angle);
      let enter: number | null = null, exact: number[] = [];
      if (angularSeparation(path.nodes[0].lon, target) <= orb) {
        const boundary = edge(path, target, orb, -1); enter = boundary.jd; exact = boundary.exact;
      }
      if (angularSeparation(path.nodes[0].lon, target) < 1e-9) exact.push(path.start);
      const hits = crossings(path, [normalizeDegrees(target - orb), target, normalizeDegrees(target + orb)]);
      const emit = (leave: number) => {
        if (enter === null || leave <= path.start || enter >= path.end) return;
        const times = [...new Set(exact.sort((a, b) => a - b).map(lifeIso))];
        result.push({ body, point: point.point, aspect: aspect.name, angle, enter: lifeIso(enter), exact: times, leave: lifeIso(leave) });
      };
      for (const hit of hits) {
        if (angularSeparation(hit.target, target) < 1e-7) { exact.push(hit.jd); continue; }
        const after = angularSeparation(path.at(hit.jd + 2 * SECOND), target) < orb;
        if (after && enter === null) { enter = hit.jd; exact = []; }
        else if (!after && enter !== null) { emit(hit.jd); enter = null; exact = []; }
      }
      if (enter !== null) {
        const boundary = edge(path, target, orb, 1); exact.push(...boundary.exact); emit(boundary.jd);
      }
    }
  }
  return result.sort((a, b) => a.enter.localeCompare(b.enter) || a.body.localeCompare(b.body) || a.point.localeCompare(b.point));
}

/** Sign and natal cusp crossings, merged when the boundaries coincide. */
export function ingresses(path: Path, body: LifeBody, cusps: readonly number[], signOnly = false): Ingress[] {
  const targets: number[] = [];
  for (const value of [...Array.from({ length: 12 }, (_, i) => i * 30), ...(signOnly ? [] : cusps)]) {
    if (!targets.some(target => angularSeparation(value, target) < 1e-7)) targets.push(value);
  }
  return crossings(path, targets).map(({ jd }) => {
    const lon = path.at(jd + 2 * SECOND);
    return { body, at: lifeIso(jd), sign: Math.floor(lon / 30), house: houseOfLongitude(lon, cusps), retrograde: motion(path.at, jd) < 0 };
  });
}

export interface RetrogradeSpan {
  body: LifeBody; from: string; to: string; fromLongitude: number; toLongitude: number; houses: number[]; points: string[];
}
/** Complete Mercury, Venus and Mars retrogrades overlapping a requested window. */
export function retrogradeSpans(engine: SwissEph, body: LifeBody, start: number, end: number, cusps: readonly number[], points: readonly LifePoint[]): RetrogradeSpan[] {
  const at = (jd: number) => longitudeAt(engine, jd, body);
  const path = longitudePath(at, start - 220, end + 220, 1, true);
  const result: RetrogradeSpan[] = [];
  const turns = path.turns.sort((a, b) => a - b);
  for (let i = 0; i + 1 < turns.length; i++) {
    const a = turns[i], b = turns[i + 1];
    if (motion(path.at, a + .01) >= 0 || a >= end || b <= start) continue;
    const from = path.at(a), to = path.at(b), span = normalizeDegrees(from - to);
    const inArc = (lon: number) => normalizeDegrees(from - lon) <= span;
    const houses = new Set([houseOfLongitude(from, cusps), houseOfLongitude(to, cusps)]);
    cusps.forEach((cusp, index) => { if (inArc(cusp)) { houses.add(index + 1); houses.add((index + 11) % 12 + 1); } });
    result.push({ body, from: lifeIso(a), to: lifeIso(b), fromLongitude: longitude4(from), toLongitude: longitude4(to),
      houses: [...houses].sort((a, b) => a - b), points: points.filter(p => inArc(p.longitude)).map(p => p.point) });
  }
  return result;
}

const PHASE_NAMES = ['new', 'crescent', 'first-quarter', 'gibbous', 'full', 'disseminating', 'last-quarter', 'balsamic'] as const;
/** Secondary progressed Moon ingresses, phases and returns on the life-time axis. */
export function progressedEvents(engine: SwissEph, born: number, start: number, end: number, cusps: readonly number[], natalMoon: number, signOnly = false) {
  const progressed = (jd: number) => born + (jd - born) / TROPICAL_YEAR_DAYS;
  const moon = longitudePath(jd => longitudeAt(engine, progressed(jd), 'moon'), start, end, 30);
  const sun = longitudePath(jd => longitudeAt(engine, progressed(jd), 'sun'), start, end, 30);
  const phase = longitudePath(jd => normalizeDegrees(moon.at(jd) - sun.at(jd)), start, end, 30);
  return {
    moonIngresses: ingresses(moon, 'moon', cusps, signOnly),
    // Where the progressed Moon stands as each phase begins: a cycle is read from its new Moon's house.
    phases: crossings(phase, PHASE_NAMES.map((_, i) => i * 45)).map(({ jd, target }) => ({ at: lifeIso(jd), kind: PHASE_NAMES[target / 45],
      longitude: longitude4(moon.at(jd)), house: houseOfLongitude(moon.at(jd), cusps) })),
    sunIngresses: crossings(sun, Array.from({ length: 12 }, (_, i) => i * 30)).map(({ jd, target }) => ({ at: lifeIso(jd), sign: target / 30 })),
    moonReturns: crossings(moon, [natalMoon]).map(({ jd }) => ({ at: lifeIso(jd) })),
  };
}

export interface Lunation {
  at: string; kind: 'new' | 'full'; longitude: number; natalHouse: number; eclipse: 'solar' | 'lunar' | null;
  /** Swiss Ephemeris eclipse type bit mask. */
  eclipseType?: number; nearPoints: { point: string; orb: number }[];
}
/** New/full moons, matched to the Moshier engine's global eclipse searches. */
export function lunations(engine: SwissEph, start: number, end: number, cusps: readonly number[], points: readonly LifePoint[]): Lunation[] {
  const eclipses: { jd: number; kind: 'solar' | 'lunar'; type: number }[] = [];
  for (const kind of ['solar', 'lunar'] as const) {
    let cursor = start - 2;
    while (cursor < end) {
      const event = kind === 'solar' ? engine.solarEclipseGlobal(cursor) : engine.lunarEclipseGlobal(cursor);
      if (!Number.isFinite(event.maximum) || event.maximum <= cursor) throw new Error('Invalid global eclipse search.');
      if (event.maximum > end + 2) break;
      eclipses.push({ jd: event.maximum, kind, type: event.type }); cursor = event.maximum + 1;
    }
  }
  const path = longitudePath(jd => phaseAt(engine, jd), start, end, 1);
  return crossings(path, [0, 180]).map(({ jd, target }) => {
    const longitude = longitudeAt(engine, jd, target === 0 ? 'sun' : 'moon');
    const eclipse = eclipses.find(e => Math.abs(e.jd - jd) < 1 && e.kind === (target === 0 ? 'solar' : 'lunar'));
    return { at: lifeIso(jd), kind: target === 0 ? 'new' : 'full', longitude: longitude4(longitude), natalHouse: houseOfLongitude(longitude, cusps),
      eclipse: eclipse?.kind ?? null, ...(eclipse ? { eclipseType: eclipse.type } : {}),
      nearPoints: points.map(p => ({ point: p.point, orb: rounded(angularSeparation(p.longitude, longitude)) })).filter(p => p.orb <= 3) };
  });
}
