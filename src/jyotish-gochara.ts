/** Sidereal sign passages and returns. The tropical lifeSky search code remains unchanged. */
import type { SwissEph } from '@typescriptify/sweph/dist/SwissEph/index.js';
import { sweCalcUt } from '@typescriptify/sweph/dist/sweph.js';
import { SEFLG_MOSEPH, SEFLG_SIDEREAL, SEFLG_NONUT } from '@typescriptify/sweph/dist/constants.js';
import { normalizeDegrees } from './ephemeris.js';
import { longitudePath, crossings, motion, lifeIso, longitude4 } from './life-transits.js';
import { GRAHA_IDS, GRAHAS, fromSign, grahaPositions } from './jyotish-natal.js';
import type { GrahaName, JyotishSky, JyotishIngress, SaturnPeriod, JyotishLunation } from './jyotish-types.js';

/** Searches do not need the expensive speed vector; snapshots still use the engine's full calculation. */
export function siderealLongitude(engine: SwissEph, jd: number, body: GrahaName): number {
  const p = sweCalcUt(engine.swed, jd, GRAHA_IDS[body], SEFLG_MOSEPH | SEFLG_SIDEREAL | SEFLG_NONUT);
  if (p.flags < 0 || !(p.flags & SEFLG_MOSEPH) || !Number.isFinite(p.xx[0])) throw new Error('Invalid sidereal longitude search.');
  return normalizeDegrees(p.xx[0] + (body === 'ketu' ? 180 : 0));
}

export function saturnState(moonHouse: number): Pick<SaturnPeriod, 'kind' | 'phase'> | null {
  const phase = moonHouse === 12 ? 'rising' : moonHouse === 1 ? 'peak' : moonHouse === 2 ? 'setting' : undefined;
  return phase ? { kind: 'sade-sati', phase } : moonHouse === 8 ? { kind: 'ashtama-shani' } : null;
}

export function computeGochara(engine: SwissEph, start: number, end: number, today: number, born: number,
  moonSign: number, natalLongitudes: Record<GrahaName, number>, scope: 'now' | 'lifetime', approximate: boolean,
  lagnaSign?: number, at = (jd: number, body: GrahaName) => siderealLongitude(engine, jd, body)): JyotishSky['gochara'] {
  const ingress: JyotishIngress[] = [], saturnPeriods: SaturnPeriod[] = [];
  const jupiterPeriods: JyotishSky['gochara']['jupiterPeriods'] = [], returns: JyotishSky['gochara']['returns'] = [];
  const bodies: readonly GrahaName[] = scope === 'now' ? GRAHAS : ['saturn', 'jupiter', 'rahu', 'ketu'];
  const boundaries = Array.from({ length: 12 }, (_, i) => i * 30);
  for (const body of bodies) {
    if (body === 'ketu') continue; // The same nodal passages are rotated below, avoiding a second ephemeris search.
    // Slow retrograde stations are explicitly refined by longitudePath; fourteen-day grids cannot skip both ends of a loop.
    // The Moon moves less than one sign per day, so the daily grid also brackets every lunar sign passage.
    const step = ['saturn', 'jupiter', 'rahu'].includes(body) ? 14 : 1;
    const path = longitudePath(jd => at(jd, body), start, end, step, !['sun', 'moon', 'rahu'].includes(body));
    const hits = crossings(path, boundaries).filter(hit => hit.jd >= start && hit.jd < end);
    for (const hit of hits) {
      // Query after the crossing: a retrograde ingress enters the previous sign, not the crossed boundary's sign.
      const longitude = path.at(hit.jd + 2 / 86400), sign = Math.floor(longitude / 30);
      const item: JyotishIngress = { body, at: lifeIso(hit.jd), sign,
        ...(lagnaSign === undefined ? {} : { house: fromSign(longitude, lagnaSign) }),
        moonHouse: fromSign(longitude, moonSign), retrograde: body === 'rahu' || motion(path.at, hit.jd) < 0 };
      ingress.push(item);
      if (body === 'rahu') {
        const opposite = normalizeDegrees(longitude + 180);
        ingress.push({ ...item, body: 'ketu', sign: (sign + 6) % 12, moonHouse: fromSign(opposite, moonSign),
          ...(lagnaSign === undefined ? {} : { house: fromSign(opposite, lagnaSign) }) });
      }
    }
    if (body === 'saturn' || body === 'jupiter') {
      const edges = [start, ...hits.map(hit => hit.jd).filter(jd => jd > start), end];
      for (let i = 0; i + 1 < edges.length; i++) {
        const a = edges[i], b = edges[i + 1], longitude = path.at(Math.min(b, a + 2 / 86400));
        const sign = Math.floor(longitude / 30), moonHouse = fromSign(longitude, moonSign);
        const period = { start: lifeIso(a), end: lifeIso(b), sign, moonHouse };
        if (body === 'jupiter') jupiterPeriods.push(period);
        else {
          const state = saturnState(moonHouse);
          if (state) saturnPeriods.push({ ...period, ...state });
        }
      }
      for (const hit of crossings(path, [natalLongitudes[body]])) {
        if (hit.jd > born + 1 / 86400 && hit.jd >= start && hit.jd < end) {
          returns.push({ body, at: lifeIso(hit.jd), longitude: longitude4(path.at(hit.jd)), approximate });
        }
      }
    }
  }
  return { approximate, positions: grahaPositions(engine, today, moonSign, lagnaSign),
    ingresses: ingress.sort((a, b) => a.at.localeCompare(b.at) || a.body.localeCompare(b.body)), saturnPeriods, jupiterPeriods,
    returns: returns.sort((a, b) => a.at.localeCompare(b.at) || a.body.localeCompare(b.body)) };
}

export function jyotishLunations(engine: SwissEph, start: number, end: number, moonSign: number, lagnaSign?: number,
  at = (jd: number, body: GrahaName) => siderealLongitude(engine, jd, body)): JyotishLunation[] {
  // Same global eclipse searches and one-day matching tolerance as lifeSky. Reuse the request's Moon/Sun grid.
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
  const phase = longitudePath(jd => normalizeDegrees(at(jd, 'moon') - at(jd, 'sun')), start, end, 1);
  return crossings(phase, [0, 180]).map(({ jd, target }) => {
    const kind = target === 0 ? 'new' as const : 'full' as const;
    const longitude = at(jd, kind === 'new' ? 'sun' : 'moon');
    const eclipse = eclipses.find(event => Math.abs(event.jd - jd) < 1 && event.kind === (kind === 'new' ? 'solar' : 'lunar'));
    return { at: lifeIso(jd), kind, longitude: longitude4(longitude), sign: Math.floor(longitude / 30),
      ...(lagnaSign === undefined ? {} : { house: fromSign(longitude, lagnaSign) }), moonHouse: fromSign(longitude, moonSign),
      eclipse: eclipse?.kind ?? null, ...(eclipse ? { eclipseType: eclipse.type } : {}) };
  });
}
