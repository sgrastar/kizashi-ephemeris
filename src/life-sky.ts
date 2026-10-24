/** The natal chart and long-term timing facts returned by the lifeSky RPC. */
import type { SwissEph } from '@typescriptify/sweph/dist/SwissEph/index.js';
import { SE_ECL_NUT, SE_ECL2HOR, SE_MEAN_NODE } from '@typescriptify/sweph/dist/constants.js';
import { natalChart, eclipticPosition, planetPosition, utcToJulianDay, normalizeDegrees, houseOfLongitude,
  lunarNode, validateProfile, housesAt } from './ephemeris.js';
import type { BirthProfile, HouseSystem } from './ephemeris.js';
import { FortuneInputError, parseDate, timezoneFormatter, localDateTimeToUtc, dayBounds } from './calendar.js';
import { profections, firdaria, zodiacalReleasing, ptolemyAges, TROPICAL_YEAR_DAYS, civilMonths, civilNoon, civilInstant, civilDayStart } from './time-lords.js';
import { LIFE_BODIES, rounded, longitude4, lifeIso, motion, contactWindows, ingresses,
  progressedEvents, retrogradeSpans, lunations, bodyPaths, longitudePath } from './life-transits.js';
import type { LifeBody, LifePoint, ContactWindow, Ingress, Station, Lunation, RetrogradeSpan } from './life-transits.js';

export const LIFE_CALCULATION_VERSION = 'typescriptify-1.0.4-moshier-tropical-life-1';
export interface LifeSkyRequest {
  profile: BirthProfile;
  houseSystem: HouseSystem;
  /** The reader's zone, independent of the birth zone. */
  timezone: string;
  today: string;
  zodiac: 'tropical';
  scope: 'now' | 'lifetime';
  /** Present residence for return charts; the birth place when absent. */
  residence?: { latitude: number; longitude: number };
}
export type Dignity = 'domicile' | 'exaltation' | 'detriment' | 'fall';
export interface LifeNatalBody {
  body: LifeBody; longitude: number; latitude: number; speed: number; sign: number; house: number;
  retrograde: boolean; dignity: Dignity | null; range?: [number, number];
}
export interface BirthSky {
  armc: number; obliquity: number; sunAltitude: number;
  /** Swiss azimuth: degrees from south towards west, 0=south, 90=west; true unrefracted altitude. */
  bodies: { azimuth: number; altitude: number }[];
}
export interface LifeNatal {
  timeKnown: boolean; instant: string | null; julianDayUt: number | null; houseSystem: HouseSystem;
  /** Fixed wire order: Sun, Moon, Mercury, Venus, Mars, Jupiter, Saturn, Uranus, Neptune, Pluto. */
  bodies: LifeNatalBody[];
  cusps: number[]; ascendant: number | null; midheaven: number | null; node: number;
  sect: 'day' | 'night' | null; lots: { fortune: number; spirit: number } | null; phaseAngle: number; sky: BirthSky | null;
}
interface LifePosition { body: LifeBody; longitude: number; sign: number; house: number; retrograde: boolean }
export type SolarReturn = { at: string; approximate: true } | {
  at: string; approximate: false; houseSystem: HouseSystem; fallback: boolean; ascendant: number; midheaven: number;
  cusps: number[]; bodies: { longitude: number; house: number }[];
};
interface TimeLords {
  profections: ReturnType<typeof profections> | null;
  firdaria: ReturnType<typeof firdaria> | null;
  releasing: { fortune: ReturnType<typeof zodiacalReleasing>; spirit: ReturnType<typeof zodiacalReleasing> } | null;
  ptolemy: ReturnType<typeof ptolemyAges>;
  currentPtolemy: ReturnType<typeof ptolemyAges>[number] | null;
}
interface LifeBase {
  calculationVersion: typeof LIFE_CALCULATION_VERSION; zodiac: 'tropical'; natal: LifeNatal; timeLords: TimeLords;
  approximate: boolean; window: { start: string; end: string };
}
export interface NowLifeSky extends LifeBase {
  scope: 'now'; todaySky: LifePosition[]; ingresses: Ingress[]; stations: Station[]; contacts: ContactWindow[];
  progressions: { approximate: boolean; positions: LifePosition[]; window: { start: string; end: string } } & ReturnType<typeof progressedEvents>;
  returns: { solar: SolarReturn[]; lunar: { at: string; ascendant: number; natalHouseOfAscendant: number; houseSystem: HouseSystem; fallback: boolean }[] };
  lunations: Lunation[]; retrogrades: RetrogradeSpan[];
}
export interface LifetimeLifeSky extends LifeBase {
  scope: 'lifetime'; milestones: ContactWindow<LifeBody | 'node'>[]; progressedPhases: ReturnType<typeof progressedEvents>['phases'];
  progressedMoonIngresses: Ingress[]; progressedMoonReturns: { at: string }[];
}
/** Plain calculated data, selected by scope; no interpretation or generated wording. */
export type LifeSky = NowLifeSky | LifetimeLifeSky;

function validate(request: LifeSkyRequest): void {
  if (!request || (request.scope !== 'now' && request.scope !== 'lifetime')) throw new FortuneInputError('対象期間は now または lifetime で指定してください。');
  if (request.zodiac !== 'tropical') throw new FortuneInputError('黄道方式は tropical を指定してください。');
  const systems = ['whole-sign', 'solar-sign', 'placidus', 'koch', 'equal'];
  if (!systems.includes(request.houseSystem)) throw new FortuneInputError('ハウス方式が不正です。');
  validateProfile(request.profile, request.houseSystem);
  timezoneFormatter(request.profile.timezone); timezoneFormatter(request.timezone);
  parseDate(request.profile.date); parseDate(request.today);
  civilDayBounds(request.today, request.timezone);
  const known = request.profile.time !== undefined && request.profile.time !== null;
  if (known === (request.houseSystem === 'solar-sign')) throw new FortuneInputError('出生時刻が不明な場合だけソーラーサイン方式を指定してください。');
  const offset = request.profile.utcOffsetMinutes;
  if (offset !== undefined && (!Number.isInteger(offset) || Math.abs(offset) > 840)) throw new FortuneInputError('UTC オフセットは -840 から 840 の整数で指定してください。');
  if (request.residence !== undefined) {
    const r = request.residence;
    if (!r || !Number.isFinite(r.latitude) || Math.abs(r.latitude) >= 89 || !Number.isFinite(r.longitude) || Math.abs(r.longitude) > 180) {
      throw new FortuneInputError('居住地は緯度 -89 より大きく 89 より小さく、経度 -180 から 180 で指定してください。');
    }
  }
}

function civilDayBounds(date: string, timezone: string) {
  if (date !== '2100-12-31') return dayBounds(date, timezone);
  return { s: civilDayStart(date, timezone).getTime() / 1000,
    e: civilDayStart('2101-01-01', timezone).getTime() / 1000 };
}

function dignity(body: LifeBody, sign: number): Dignity | null {
  const domiciles: Partial<Record<LifeBody, number[]>> = { sun: [4], moon: [3], mercury: [2, 5], venus: [1, 6], mars: [0, 7], jupiter: [8, 11], saturn: [9, 10] };
  const exaltations: Partial<Record<LifeBody, number>> = { sun: 0, moon: 1, mercury: 5, venus: 11, mars: 9, jupiter: 3, saturn: 6 };
  const homes = domiciles[body];
  if (!homes) return null;
  // Mercury is both domiciled/exalted in Virgo and in detriment/fall in Pisces; domicile/detriment takes precedence.
  if (homes.includes(sign)) return 'domicile';
  if (exaltations[body] === sign) return 'exaltation';
  if (homes.some(s => (s + 6) % 12 === sign)) return 'detriment';
  return (exaltations[body]! + 6) % 12 === sign ? 'fall' : null;
}

function birthData(engine: SwissEph, request: LifeSkyRequest) {
  const { profile, houseSystem } = request;
  // dayBounds in the existing unknown-time chart stops at 2100; extend only this new API's final civil day.
  const chart = profile.time == null && profile.date === '2100-12-31' ?
    { ...natalChart(engine, { ...profile, time: '12:00' }, 'solar-sign'), timeKnown: false as const, instant: null, julianDayUt: null, planets: null } :
    natalChart(engine, profile, houseSystem);
  const born = chart.julianDayUt ?? utcToJulianDay(localDateTimeToUtc(profile.date, '12:00', profile.timezone));
  const raw = LIFE_BODIES.map(body => eclipticPosition(engine, born, body));
  let sky: BirthSky | null = null, sect: 'day' | 'night' | null = null;
  if (chart.timeKnown) {
    const geo = { latitude: profile.latitude!, longitude: profile.longitude! };
    const bodies = raw.map(p => {
      // Swiss uses south through west, rather than north through east; use latitude as well as longitude.
      const horizontal = engine.azalt(born, geo, p.longitude, p.latitude, 1, SE_ECL2HOR);
      return { azimuth: rounded(horizontal.azimuth, 2), altitude: rounded(horizontal.trueAltitude, 2) };
    });
    const altitude = engine.azalt(born, geo, raw[0].longitude, raw[0].latitude, 1, SE_ECL2HOR).trueAltitude;
    sect = altitude >= 0 ? 'day' : 'night';
    sky = { armc: longitude4(engine.houses(born, geo, 'W').armc), obliquity: rounded(engine.calc(born, SE_ECL_NUT).longitude), sunAltitude: rounded(altitude, 2), bodies };
  }
  const difference = raw[1].longitude - raw[0].longitude;
  const lots = chart.ascendant === null ? null : {
    fortune: normalizeDegrees(chart.ascendant + (sect === 'day' ? difference : -difference)),
    spirit: normalizeDegrees(chart.ascendant + (sect === 'day' ? -difference : difference)),
  };
  const bodies: LifeNatalBody[] = raw.map((p, i) => ({ body: LIFE_BODIES[i], longitude: longitude4(p.longitude), latitude: rounded(p.latitude),
    speed: rounded(p.speed), sign: p.sign, house: houseOfLongitude(p.longitude, chart.cusps), retrograde: p.speed < 0, dignity: dignity(LIFE_BODIES[i], p.sign) }));
  if (!chart.timeKnown) {
    const bounds = civilDayBounds(profile.date, profile.timezone);
    bodies[1].range = [bounds.s, bounds.e].map(s => longitude4(planetPosition(engine, utcToJulianDay(new Date(s * 1000)), 'moon').longitude)) as [number, number];
  }
  const natal: LifeNatal = { timeKnown: chart.timeKnown, instant: chart.timeKnown ? lifeIso(born) : null, julianDayUt: chart.julianDayUt,
    houseSystem, bodies, cusps: chart.cusps.map(longitude4), ascendant: chart.ascendant === null ? null : longitude4(chart.ascendant),
    midheaven: chart.midheaven === null ? null : longitude4(chart.midheaven), node: longitude4(lunarNode(engine, born).longitude),
    sect, lots: lots && { fortune: longitude4(lots.fortune), spirit: longitude4(lots.spirit) }, phaseAngle: longitude4(difference), sky };
  const points: LifePoint[] = LIFE_BODIES.slice(0, 7).map((point, i) => ({ point, longitude: raw[i].longitude }));
  if (chart.ascendant !== null) points.push({ point: 'ascendant', longitude: chart.ascendant }, { point: 'midheaven', longitude: chart.midheaven! },
    { point: 'fortune', longitude: lots!.fortune }, { point: 'spirit', longitude: lots!.spirit });
  return { natal, born, raw, points, cusps: chart.cusps, ascendant: chart.ascendant, lots };
}

function timeLords(request: LifeSkyRequest, data: ReturnType<typeof birthData>, start: number, end: number, today: number): TimeLords {
  const { natal, born, ascendant, lots } = data;
  const a = lifeIso(start), b = lifeIso(end), birth = lifeIso(born);
  const ages = ptolemyAges(birth);
  const known = natal.timeKnown;
  return {
    profections: known && request.scope === 'now' ? profections(request.profile, Math.floor(ascendant! / 30), a, b) : null,
    firdaria: known ? firdaria(birth, natal.sect!, a, b) : null,
    releasing: known ? {
      fortune: zodiacalReleasing(birth, Math.floor(lots!.fortune / 30), Math.floor(lots!.fortune / 30), a, b, request.scope === 'now' ? 3 : 2),
      spirit: zodiacalReleasing(birth, Math.floor(lots!.spirit / 30), Math.floor(lots!.fortune / 30), a, b, request.scope === 'now' ? 3 : 2),
    } : null,
    ptolemy: request.scope === 'lifetime' ? ages : ages.filter(age => Date.parse(age.start) <= Date.parse(lifeIso(today)) && (age.end === null || Date.parse(age.end) > Date.parse(lifeIso(today)))),
    currentPtolemy: ages.find(age => Date.parse(age.start) <= Date.parse(lifeIso(today)) && (age.end === null || Date.parse(age.end) > Date.parse(lifeIso(today)))) ?? null,
  };
}

function positions(engine: SwissEph, jd: number, cusps: readonly number[], bodies: readonly LifeBody[] = LIFE_BODIES): LifePosition[] {
  return bodies.map(body => {
    const p = planetPosition(engine, jd, body);
    return { body, longitude: longitude4(p.longitude), sign: p.sign, house: houseOfLongitude(p.longitude, cusps), retrograde: p.speed < 0 };
  });
}

function returnEvents(engine: SwissEph, request: LifeSkyRequest, natal: LifeNatal, raw: ReturnType<typeof eclipticPosition>[], cusps: number[], start: number, end: number, fastStart: number, fastEnd: number): NowLifeSky['returns'] {
  const solar: SolarReturn[] = [], lunar: NowLifeSky['returns']['lunar'] = [];
  const geo = request.residence ?? { latitude: request.profile.latitude!, longitude: request.profile.longitude! };
  const chosen = request.houseSystem as Exclude<HouseSystem, 'solar-sign'>;
  const chartAt = (jd: number) => {
    try { return { ...housesAt(engine, jd, geo, chosen), houseSystem: chosen, fallback: false }; }
    catch (error) {
      if (!(error instanceof FortuneInputError) || chosen === 'whole-sign') throw error;
      return { ...housesAt(engine, jd, geo, 'whole-sign'), houseSystem: 'whole-sign' as const, fallback: true };
    }
  };
  for (let cursor = start - 1; cursor < end;) {
    const jd = engine.sunCrossing(raw[0].longitude, cursor).jd;
    if (!Number.isFinite(jd) || jd <= cursor) throw new Error('Invalid solar return search.');
    if (jd >= end) break;
    if (jd >= start) {
      if (!natal.timeKnown) solar.push({ at: lifeIso(jd), approximate: true });
      else {
        const chart = chartAt(jd);
        solar.push({ at: lifeIso(jd), approximate: false, houseSystem: chart.houseSystem, fallback: chart.fallback,
          ascendant: longitude4(chart.ascendant), midheaven: longitude4(chart.midheaven), cusps: chart.cusps.map(longitude4),
          bodies: LIFE_BODIES.map(body => { const longitude = planetPosition(engine, jd, body).longitude; return { longitude: longitude4(longitude), house: houseOfLongitude(longitude, chart.cusps) }; }) });
      }
    }
    cursor = jd + 1;
  }
  if (natal.timeKnown) for (let cursor = fastStart - 1; cursor < fastEnd;) {
    const jd = engine.moonCrossing(raw[1].longitude, cursor).jd;
    if (!Number.isFinite(jd) || jd <= cursor) throw new Error('Invalid lunar return search.');
    if (jd >= fastEnd) break;
    if (jd >= fastStart) {
      const chart = chartAt(jd);
      lunar.push({ at: lifeIso(jd), ascendant: longitude4(chart.ascendant), natalHouseOfAscendant: houseOfLongitude(chart.ascendant, cusps), houseSystem: chart.houseSystem, fallback: chart.fallback });
    }
    cursor = jd + 1;
  }
  return { solar, lunar };
}

function lifetimeEnd(request: LifeSkyRequest): number {
  const { profile } = request;
  const ninetieth = civilMonths(profile.date, 1080);
  // The final accepted birth date must include its entire civil day, even west of UTC.
  // An explicit birth offset overrides the zone's historical clock, just as natalChart does.
  const birthDayEnd = profile.time != null && profile.utcOffsetMinutes !== undefined ?
    new Date(Date.UTC(2101, 0, 1) - profile.utcOffsetMinutes * 60_000) : civilDayStart('2101-01-01', profile.timezone);
  const cap = Math.max(utcToJulianDay(new Date('2101-01-01T00:00:00Z')), utcToJulianDay(birthDayEnd));
  return ninetieth > '2100-12-31' ? cap :
    Math.min(cap, utcToJulianDay(civilInstant(ninetieth, profile.time ?? '12:00', profile.timezone)));
}

/** Compute either the surrounding years or the first ninety years, using one request-local engine. */
export function computeLifeSky(engine: SwissEph, request: LifeSkyRequest): LifeSky {
  validate(request);
  const data = birthData(engine, request);
  const { natal, born, raw, points, cusps } = data;
  const today = utcToJulianDay(localDateTimeToUtc(request.today, '12:00', request.timezone));
  const month = (n: number) => utcToJulianDay(civilNoon(civilMonths(request.today, n), request.timezone));
  const start = request.scope === 'now' ? month(-12) : born;
  const end = request.scope === 'now' ? month(36) : lifetimeEnd(request);
  if (end <= start) throw new FortuneInputError('計算期間の終了が開始以前になります。出生日時と対象日を確認してください。');
  const base: LifeBase = { calculationVersion: LIFE_CALCULATION_VERSION, zodiac: 'tropical', natal, approximate: !natal.timeKnown,
    window: { start: lifeIso(start), end: lifeIso(end) }, timeLords: timeLords(request, data, start, end, today) };
  if (request.scope === 'lifetime') {
    const milestones: ContactWindow<LifeBody | 'node'>[] = [];
    for (const { body, path } of bodyPaths(engine, LIFE_BODIES.slice(5), start, end, 5)) {
      const aspects = body === 'neptune' || body === 'pluto' ? [{ name: 'square', angle: 90 }] :
        [{ name: 'conjunction', angle: 0 }, { name: 'square', angle: 90 }, { name: 'opposition', angle: 180 },
          ...(body === 'uranus' ? [{ name: 'trine', angle: 120 }] : [])];
      milestones.push(...contactWindows(path, body, [{ point: body, longitude: raw[LIFE_BODIES.indexOf(body)].longitude }], 2, aspects));
    }
    // The nodal return (about 18.6 years) by the mean node, which comes back once rather than wobbling about the point.
    const meanNode = (jd: number) => normalizeDegrees(engine.calc(jd, SE_MEAN_NODE).longitude);
    milestones.push(...contactWindows(longitudePath(meanNode, start, end, 5), 'node',
      [{ point: 'node', longitude: meanNode(born) }], 2, [{ name: 'conjunction', angle: 0 }]));
    // Every body starts conjunct its own birth position and may loop back to it in the first year; the first true
    // return (Jupiter's, at about 12; the progressed Moon's, at about 27) is long after, so returns inside two years
    // of birth are no milestone.
    const settled = lifeIso(born + 2 * TROPICAL_YEAR_DAYS);
    const passed = milestones.filter(m => m.aspect !== 'conjunction' || m.enter > settled);
    const events = progressedEvents(engine, born, start, end, cusps, raw[1].longitude, true);
    return { ...base, scope: 'lifetime', milestones: passed.sort((a, b) => a.enter.localeCompare(b.enter)),
      progressedPhases: events.phases, progressedMoonIngresses: events.moonIngresses,
      progressedMoonReturns: events.moonReturns.filter(r => r.at > settled) };
  }
  const day = (n: number) => {
    const date = new Date(`${request.today}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + n);
    return utcToJulianDay(civilNoon(date.toISOString().slice(0, 10), request.timezone));
  };
  const fastStart = day(-31), fastEnd = day(92);
  const ingress: Ingress[] = [], stations: Station[] = [], contacts: ContactWindow[] = [];
  const paths = [...bodyPaths(engine, ['sun', 'mercury', 'venus', 'mars'], fastStart, fastEnd, .25),
    ...bodyPaths(engine, LIFE_BODIES.slice(5), start, end, 1)];
  for (const { body, path } of paths) {
    const slow = LIFE_BODIES.indexOf(body) >= 5;
    ingress.push(...ingresses(path, body, cusps));
    stations.push(...path.turns.map(jd => ({ body, at: lifeIso(jd), kind: motion(path.at, jd + .01) < 0 ? 'retrograde' as const : 'direct' as const,
      longitude: longitude4(path.at(jd)), house: houseOfLongitude(path.at(jd), cusps) })));
    contacts.push(...contactWindows(path, body, points, slow ? (body === 'jupiter' || body === 'saturn' ? 3 : 2) : 1));
  }
  const pStart = month(-48), pEnd = month(48);
  return { ...base, scope: 'now', todaySky: positions(engine, today, cusps),
    ingresses: ingress.sort((a, b) => a.at.localeCompare(b.at)), stations: stations.sort((a, b) => a.at.localeCompare(b.at)),
    contacts: contacts.sort((a, b) => a.enter.localeCompare(b.enter)),
    progressions: { approximate: !natal.timeKnown, positions: positions(engine, born + (today - born) / TROPICAL_YEAR_DAYS, cusps, LIFE_BODIES.slice(0, 5)),
      window: { start: lifeIso(pStart), end: lifeIso(pEnd) }, ...progressedEvents(engine, born, pStart, pEnd, cusps, raw[1].longitude) },
    returns: returnEvents(engine, request, natal, raw, cusps, start, end, fastStart, fastEnd),
    lunations: lunations(engine, start, end, cusps, points),
    retrogrades: (['mercury', 'venus', 'mars'] as const).flatMap(body => retrogradeSpans(engine, body, start, end, cusps, points)),
  };
}
