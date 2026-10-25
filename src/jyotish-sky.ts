/** New sidereal RPC; the existing lifeSky calculation and its tropical conventions are untouched. */
import type { SwissEph } from '@typescriptify/sweph/dist/SwissEph/index.js';
import { FortuneInputError, parseDate, timezoneFormatter, localDateTimeToUtc } from './calendar.js';
import { utcToJulianDay, validateProfile, normalizeDegrees } from './ephemeris.js';
import { civilMonths, civilDayStart, civilInstant, civilNoon } from './time-lords.js';
import { lifeIso, longitude4, rounded } from './life-transits.js';
import { setJyotishMode, siderealPosition, lahiriAyanamsa, GRAHAS, natalGrahas, nakshatra, navamsaSign } from './jyotish-natal.js';
import { DASHA_YEAR_DAYS, validateDashaYear, vimshottari } from './dasha.js';
import { computeGochara, jyotishLunations, siderealLongitude } from './jyotish-gochara.js';
import type { GrahaName, JyotishSkyRequest, JyotishSky, DashaUncertainty } from './jyotish-types.js';
export type * from './jyotish-types.js';

export const JYOTISH_CALCULATION_VERSION = 'typescriptify-1.0.4-moshier-lahiri-mean-vimshottari-1';

function validate(request: JyotishSkyRequest): void {
  if (!request || !['now', 'lifetime'].includes(request.scope)) throw new FortuneInputError('対象期間は now または lifetime で指定してください。');
  const p = request.profile;
  validateProfile(p, p?.time == null ? 'solar-sign' : 'whole-sign');
  timezoneFormatter(p.timezone); timezoneFormatter(request.timezone);
  parseDate(p.date); parseDate(request.today);
  civilDayStart(p.date, p.timezone); civilDayStart(request.today, request.timezone);
  if (p.utcOffsetMinutes !== undefined && (!Number.isInteger(p.utcOffsetMinutes) || Math.abs(p.utcOffsetMinutes) > 840)) throw new FortuneInputError('UTCオフセットが不正です。');
  validateDashaYear(request.dashaYearDays ?? DASHA_YEAR_DAYS);
  if (request.residence !== undefined) {
    const r = request.residence;
    if (!r || !Number.isFinite(r.latitude) || Math.abs(r.latitude) >= 89 || !Number.isFinite(r.longitude) || Math.abs(r.longitude) > 180) throw new FortuneInputError('居住地の緯度・経度を確認してください。');
  }
}

export function computeJyotishSky(engine: SwissEph, request: JyotishSkyRequest): JyotishSky {
  validate(request);
  setJyotishMode(engine);
  const p = request.profile, known = p.time != null;
  const birth = localDateTimeToUtc(p.date, known ? p.time! : '12:00', p.timezone, known ? p.utcOffsetMinutes : undefined);
  const born = utcToJulianDay(birth), today = utcToJulianDay(civilNoon(request.today, request.timezone));
  const startDate = request.scope === 'now' ? civilNoon(civilMonths(request.today, -12), request.timezone) : birth;
  const endDate = request.scope === 'now' ? civilNoon(civilMonths(request.today, 36), request.timezone) :
    civilInstant(civilMonths(p.date, 90 * 12), known ? p.time! : '12:00', p.timezone);
  const start = utcToJulianDay(startDate), end = utcToJulianDay(endDate);
  const window = { start: lifeIso(start), end: lifeIso(end) };
  const raw = Object.fromEntries(GRAHAS.map(body => [body, siderealPosition(engine, born, body)])) as Record<GrahaName, ReturnType<typeof siderealPosition>>;
  const moonSign = raw.moon.sign, ayanamsa = lahiriAyanamsa(engine, born);
  const ascendant = known ? normalizeDegrees(engine.houses(born, { latitude: p.latitude!, longitude: p.longitude! }, 'W').ascendant - ayanamsa) : undefined;
  const lagnaSign = ascendant === undefined ? undefined : Math.floor(ascendant / 30);
  const yearDays = request.dashaYearDays ?? DASHA_YEAR_DAYS;
  const schedule = (instant: string, moon: number) => vimshottari(instant, moon, window.start, window.end, lifeIso(today), yearDays, request.scope === 'now' ? 3 : 2);
  const dasha = schedule(birth.toISOString(), raw.moon.longitude);
  let uncertainty: DashaUncertainty | undefined;
  let moonRange: [number, number] | undefined;
  const moonSignCandidates = [moonSign];
  if (!known) {
    const nextDate = civilMonths(p.date, 0);
    const midnight = civilDayStart(nextDate, p.timezone);
    const next = new Date(Date.parse(nextDate + 'T12:00:00Z') + 86_400_000).toISOString().slice(0, 10);
    const after = civilDayStart(next, p.timezone);
    const alternatives = [midnight, after].map(date => {
      const moon = siderealPosition(engine, utcToJulianDay(date), 'moon');
      if (!moonSignCandidates.includes(moon.sign)) moonSignCandidates.push(moon.sign);
      return { birthInstant: date.toISOString(), moonLongitude: moon.longitude, moonSign: moon.sign,
        schedule: schedule(date.toISOString(), moon.longitude) };
    });
    moonRange = alternatives.map(a => longitude4(a.moonLongitude)) as [number, number];
    const ordered = (values: string[]) => values.sort() as [string, string];
    uncertainty = { birthWindow: { start: midnight.toISOString(), end: after.toISOString() }, alternatives,
      mahaStartRange: ordered(alternatives.map(a => a.schedule.birthBalance.start)),
      mahaEndRange: ordered(alternatives.map(a => a.schedule.birthBalance.end)),
      startingLords: [...new Set(alternatives.map(a => a.schedule.birthBalance.lord))] };
  }
  const natal: JyotishSky['natal'] = { timeKnown: known, instant: known ? birth.toISOString() : null, representative: birth.toISOString(),
    ayanamsa: rounded(ayanamsa, 8), grahas: natalGrahas(engine, born, moonSign, lagnaSign),
    outer: (['uranus', 'neptune', 'pluto'] as const).map(body => {
      const position = siderealPosition(engine, born, body);
      return { body, longitude: longitude4(position.longitude), latitude: rounded(position.latitude), speed: rounded(position.speed, 6), sign: position.sign, retrograde: position.speed < 0 };
    }),
    ...(ascendant === undefined ? {} : { lagna: { longitude: longitude4(ascendant), sign: lagnaSign!, nakshatra: nakshatra(ascendant), navamsaSign: navamsaSign(ascendant) } }),
    moonSign, moonSignCandidates: moonSignCandidates.sort((a, b) => a - b), ...(moonRange ? { moonRange } : {}) };
  // This cache belongs to one synchronous request only; phase searches reuse the already sampled daily Sun/Moon.
  const cache = new Map<GrahaName, Map<number, number>>();
  const at = (jd: number, body: GrahaName) => {
    let values = cache.get(body);
    if (!values) { values = new Map(); cache.set(body, values); }
    let value = values.get(jd);
    if (value === undefined) { value = siderealLongitude(engine, jd, body); values.set(jd, value); }
    return value;
  };
  return { calculationVersion: JYOTISH_CALCULATION_VERSION, zodiac: 'sidereal-lahiri', ayanamsa: 'lahiri', node: 'mean', scope: request.scope,
    approximate: !known, window, natal, dasha: { ...dasha, ...(uncertainty ? { uncertainty } : {}) },
    gochara: computeGochara(engine, start, end, today, born, moonSign,
      Object.fromEntries(GRAHAS.map(body => [body, raw[body].longitude])) as Record<GrahaName, number>, request.scope, !known, lagnaSign, at),
    lunations: request.scope === 'now' ? jyotishLunations(engine, start, end, moonSign, lagnaSign, at) : [] };
}
