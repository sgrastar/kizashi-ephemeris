/**
 * The births a day's Moon meets best. Every birth instant in an age range is read the way the daily perfections
 * read a birth chart (src/perfections.ts): which aspects the Moon makes exact to it inside the civil day. A birth
 * with no square or opposition wins; then the caller's house ranking (the Moon's natal house), the fewest other
 * aspects, the most trines, and last the trine nearest the day's local noon.
 *
 * The search runs in two passes so that it fits a Worker: the planets at noon on each birth day pick the days
 * worth reading, then those days are read every few minutes at every place. The planets do not depend on the
 * place, so each instant is calculated once and only its houses are calculated per place. The finalists are
 * then read again with the daily calculation itself, which also gives their charts.
 */
import type { SwissEph } from '@typescriptify/sweph/dist/SwissEph/index.js';
import { natalChart, planetPosition, normalizeDegrees, utcToJulianDay, wholeSignHouse, lunarNode } from './ephemeris.js';
import type { OuterPlanetName } from './ephemeris.js';
import { FortuneInputError, dayBounds, localDateTimeToUtc, parseDate, timezoneFormatter } from './calendar.js';
import { MAJOR_ASPECTS, prepareNatal, dayFeatures } from './features.js';
import { orthodoxDay } from './perfections.js';
import type { Perfection } from './perfections.js';
import type { AspectName, PlanetName } from './types.js';

export interface BirthPlace { id: string; region: string; latitude: number; longitude: number; timezone: string }

export interface BestBirthsRequest {
  /** The day being read (YYYY-MM-DD) and the zone its civil day is counted in. */
  date: string;
  timezone: string;
  /** Ages on that day, inclusive. */
  minAge: number;
  maxAge: number;
  places: readonly BirthPlace[];
  /** How the caller ranks the Moon's natal house 1..12 (index 0 = house 1); higher is better. */
  houseRank: readonly number[];
  /** Births per region. */
  perRegion: number;
  /** The best this many are crowned (default 3). */
  crowns?: number;
  /** Chosen birth dates lie at least this many days apart (default 7). */
  spreadDays?: number;
  /** Birth instants are read every this many minutes (default 20). */
  stepMinutes?: number;
  /** How many birth days are read in depth (default 200); up to three times as many while a region is short. */
  depth?: number;
}

/** What one birth scores; compared field by field, in this order. */
export interface BirthScore {
  /** The caller's rank of the Moon's natal house, the lowest over the day's trines. */
  house: number;
  /** Conjunctions and sextiles (never a square or opposition: those births are left out). */
  other: number;
  trines: number;
  /** Minutes between the day's local noon and the trine nearest to it. */
  gapMinutes: number;
}

const CHART_BODIES = ['sun', 'moon', 'mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto'] as const;

export interface BestBirth {
  rank: number;
  crowned: boolean;
  region: string;
  placeId: string;
  /** Local birth date and time at the place, its offset from UTC then, and the instant. */
  date: string;
  time: string;
  utcOffsetMinutes: number;
  instant: string;
  age: number;
  score: BirthScore;
  perfections: Perfection[];
  /** The birth chart: the ten bodies (Sun … Pluto) with their daily motion, the true node and the angles. */
  natal: { longitudes: number[]; speeds: number[]; node: number; ascendant: number; midheaven: number };
}

export interface BestBirths {
  date: string;
  timezone: string;
  /** The sky at the day's local noon, for a transit ring: the ten bodies and the true node. */
  today: { longitudes: number[]; speeds: number[]; node: number };
  births: BestBirth[];
  /** Regions that got fewer than perRegion births, with how many are missing. */
  shortfall: Record<string, number>;
}

const SEARCHED: readonly (PlanetName | OuterPlanetName)[] = ['sun', 'moon', 'mercury', 'venus', 'mars', 'jupiter', 'saturn'];
const MINUTE = 60_000, DAY = 86_400_000;

type Kind = 'trine' | 'hard' | 'other';
const kindOf = (aspect: AspectName): Kind => aspect === 'trine' ? 'trine' : aspect === 'square' || aspect === 'opposition' ? 'hard' : 'other';

/** The day's Moon: where it starts, how far it goes, and when. */
interface MoonDay { startMs: number; endMs: number; start: number; span: number; noonMs: number }

/** The lunar aspects that perfect inside the day to a natal longitude: where the Moon is then, and roughly when. */
function perfectionsTo(longitude: number, aspects: readonly { name: AspectName; angle: number }[], day: MoonDay) {
  const found: { kind: Kind; at: number; ms: number }[] = [];
  for (const { name, angle } of aspects) {
    for (const offset of angle === 0 || angle === 180 ? [angle] : [angle, 360 - angle]) {
      const at = normalizeDegrees(longitude + offset);
      const arc = normalizeDegrees(at - day.start);
      // The Moon's speed hardly changes within a day: a proportional instant ranks well enough.
      if (arc < day.span) found.push({ kind: kindOf(name), at, ms: day.startMs + arc / day.span * (day.endMs - day.startMs) });
    }
  }
  return found;
}

const ANGLE_ASPECTS = MAJOR_ASPECTS.filter(a => a.name === 'conjunction' || a.name === 'opposition');

/** Local wall date, time and UTC offset of an instant in a zone. */
export function wallClock(ms: number, formatter: Intl.DateTimeFormat) {
  const p = Object.fromEntries(formatter.formatToParts(new Date(ms)).map(part => [part.type, part.value]));
  const wall = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}`, utcOffsetMinutes: Math.round((wall - ms) / MINUTE) };
}

function clocks() {
  const formatters = new Map<string, Intl.DateTimeFormat>();
  return (ms: number, timezone: string) => {
    let formatter = formatters.get(timezone);
    if (!formatter) {
      formatter = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
      formatters.set(timezone, formatter);
    }
    return wallClock(ms, formatter);
  };
}

function ageOn(birth: string, day: string): number {
  const b = parseDate(birth), d = parseDate(day);
  return d.year - b.year - (d.month < b.month || (d.month === b.month && d.day < b.day) ? 1 : 0);
}

// Fewer other aspects before more trines: a sextile or conjunction can be the aspect a reading takes.
const better = (a: BirthScore, b: BirthScore) =>
  a.house !== b.house ? a.house > b.house : a.other !== b.other ? a.other < b.other : a.trines !== b.trines ? a.trines > b.trines : a.gapMinutes < b.gapMinutes;
const compare = (a: { score: BirthScore }, b: { score: BirthScore }) => better(a.score, b.score) ? -1 : better(b.score, a.score) ? 1 : 0;

/** FNV-1a, 32 bits: a fixed, even spread for breaking ties. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}

const isInteger = (value: unknown, low: number, high: number) => Number.isInteger(value) && (value as number) >= low && (value as number) <= high;

function validate(request: BestBirthsRequest) {
  const { minAge, maxAge, perRegion, houseRank, places } = request;
  const { year } = parseDate(request.date);
  timezoneFormatter(request.timezone);
  // Birth dates go through the same date parser, which starts in 1900.
  if (!isInteger(minAge, 0, 120) || !isInteger(maxAge, minAge, 120) || year - maxAge - 1 < 1900) {
    throw new FortuneInputError('年齢の範囲は 0 から 120 の整数で、下限が上限以下、生まれ年が 1900 年以降になるように指定してください。');
  }
  if (!isInteger(perRegion, 1, 50)) throw new FortuneInputError('地域ごとの人数は 1 から 50 で指定してください。');
  if (request.crowns !== undefined && !isInteger(request.crowns, 0, 100)) throw new FortuneInputError('王冠の数は 0 から 100 で指定してください。');
  if (request.spreadDays !== undefined && !isInteger(request.spreadDays, 0, 366)) throw new FortuneInputError('誕生日の間隔は 0 から 366 日で指定してください。');
  if (request.stepMinutes !== undefined && !isInteger(request.stepMinutes, 1, 60)) throw new FortuneInputError('出生時刻の刻みは 1 から 60 分で指定してください。');
  if (request.depth !== undefined && !isInteger(request.depth, 1, 2000)) throw new FortuneInputError('詳しく読む日数は 1 から 2000 で指定してください。');
  if (houseRank.length !== 12 || !houseRank.every(Number.isFinite)) throw new FortuneInputError('ハウスの順位は 12 個の数で指定してください。');
  if (places.length === 0 || places.length > 2000) throw new FortuneInputError('出生地は 1 から 2000 か所で指定してください。');
  for (const place of places) {
    if (!(Math.abs(place.latitude) <= 66) || !(Math.abs(place.longitude) <= 180)) throw new FortuneInputError(`出生地 ${place.id} の緯度経度が範囲外です。`);
    timezoneFormatter(place.timezone);
  }
}

/** The score of a birth from its exact perfections, as the search scores it. */
function scoreOf(perfections: readonly Perfection[], houseRank: readonly number[], noonMs: number): BirthScore | null {
  if (perfections.some(p => kindOf(p.aspect) === 'hard')) return null;
  const trines = perfections.filter(p => p.aspect === 'trine');
  if (trines.length === 0) return null;
  return { house: Math.min(...trines.map(p => houseRank[p.house - 1])), other: perfections.length - trines.length, trines: trines.length,
    gapMinutes: Math.round(Math.min(...trines.map(p => Math.abs(Date.parse(p.exactAt) - noonMs))) / MINUTE) };
}

export function searchBestBirths(engine: SwissEph, request: BestBirthsRequest): BestBirths {
  validate(request);
  const { date, timezone, minAge, maxAge, places, houseRank, perRegion } = request;
  const crowns = request.crowns ?? 3, spreadDays = request.spreadDays ?? 7;
  const step = (request.stepMinutes ?? 20) * MINUTE, depth = request.depth ?? 200;
  const bounds = dayBounds(date, timezone);
  const startJd = utcToJulianDay(new Date(bounds.s * 1000)), endJd = utcToJulianDay(new Date(bounds.e * 1000));
  const moonStart = planetPosition(engine, startJd, 'moon').longitude;
  const day: MoonDay = { startMs: bounds.s * 1000, endMs: bounds.e * 1000, start: moonStart,
    span: normalizeDegrees(planetPosition(engine, endJd, 'moon').longitude - moonStart),
    noonMs: localDateTimeToUtc(date, '12:00', timezone).getTime() };
  const clock = clocks();
  const inAgeRange = (birthDate: string) => { const age = ageOn(birthDate, date); return age >= minAge && age <= maxAge; };

  // Pass 1: birth days (UT) ranked by the trines their planets make at noon. A day is left out only when a planet
  // makes a square or opposition all day long: at its start and at its end (a planet moves a few degrees at most).
  const { year, month, day: dd } = parseDate(date);
  const first = Date.UTC(year - maxAge - 1, month - 1, dd) - DAY, last = Date.UTC(year - minAge, month - 1, dd) + DAY;
  const hardAt = (jd: number, body: PlanetName | OuterPlanetName) =>
    perfectionsTo(planetPosition(engine, jd, body).longitude, MAJOR_ASPECTS, day).some(p => p.kind === 'hard');
  const days: { ms: number; trines: number; other: number }[] = [];
  for (let ms = first; ms <= last; ms += DAY) {
    const jd = utcToJulianDay(new Date(ms + DAY / 2));
    let allDayHard = false, trines = 0, other = 0, moonTrine = false;
    for (const body of SEARCHED) {
      const position = planetPosition(engine, jd, body);
      if (body === 'moon') {
        // The birth time places the Moon anywhere in its day: can it make a trine?
        for (let k = -6; k <= 6 && !moonTrine; k++) {
          moonTrine = perfectionsTo(position.longitude + position.speed * k / 12, MAJOR_ASPECTS, day).some(p => p.kind === 'trine');
        }
        continue;
      }
      const found = perfectionsTo(position.longitude, MAJOR_ASPECTS, day);
      if (found.some(p => p.kind === 'hard') && hardAt(jd - 0.5, body) && hardAt(jd + 0.5, body)) { allDayHard = true; break; }
      for (const p of found) if (p.kind === 'trine') trines++; else if (p.kind === 'other') other++;
    }
    if (!allDayHard && trines + Number(moonTrine) > 0) days.push({ ms, trines: trines + Number(moonTrine), other });
  }
  days.sort((a, b) => b.trines - a.trines || a.other - b.other || a.ms - b.ms);

  // Pass 2: chosen days every few minutes; the planets once per instant, the angles per place. Each place keeps its
  // best instant per local birth date, and only births in the age range, so the spreading below has alternatives.
  type Candidate = { place: BirthPlace; ms: number; score: BirthScore };
  const pool = new Map<string, Candidate>();
  const readDay = (dayMs: number) => {
    const nearEdge = dayMs < first + 3 * DAY || dayMs > last - 3 * DAY;
    const offsets = places.map(place => clock(dayMs + DAY / 2, place.timezone).utcOffsetMinutes * MINUTE);
    for (let ms = dayMs; ms < dayMs + DAY; ms += step) {
      const jd = utcToJulianDay(new Date(ms));
      const found = SEARCHED.flatMap(body => perfectionsTo(planetPosition(engine, jd, body).longitude, MAJOR_ASPECTS, day));
      if (found.some(p => p.kind === 'hard')) continue;
      const trines = found.filter(p => p.kind === 'trine');
      if (trines.length === 0) continue;
      const other = found.length - trines.length;
      const gapMinutes = Math.min(...trines.map(p => Math.abs(p.ms - day.noonMs))) / MINUTE;
      // Places on the same coordinates (towns a few kilometres apart, given to a tenth of a degree) share their angles.
      const housesAt = new Map<string, ReturnType<SwissEph['houses']>>();
      places.forEach((place, index) => {
        // The offset at the day's middle gives the local date; a DST change that day is settled when choosing.
        const localDay = Math.floor((ms + offsets[index]) / DAY);
        if (nearEdge && !inAgeRange(new Date(localDay * DAY).toISOString().slice(0, 10))) return;
        const where = `${place.latitude},${place.longitude}`;
        let houses = housesAt.get(where);
        if (!houses) housesAt.set(where, houses = engine.houses(jd, { latitude: place.latitude, longitude: place.longitude }, 'W'));
        const angles = [houses.ascendant, houses.mc].flatMap(l => perfectionsTo(l, ANGLE_ASPECTS, day));
        if (angles.some(p => p.kind === 'hard')) return;
        const house = Math.min(...trines.map(p => houseRank[wholeSignHouse(p.at, houses.ascendant) - 1]));
        const score = { house, other: other + angles.length, trines: trines.length, gapMinutes };
        const key = `${place.id}|${localDay}`, held = pool.get(key);
        if (!held || better(score, held.score)) pool.set(key, { place, ms, score });
      });
    }
  };

  // A finalist is read again with the daily calculation from the very instant searched (its UTC offset kept, so a
  // repeated hour at a DST change stays the hour found); one that turns out to make a hard aspect is passed over.
  type Final = { candidate: Candidate; clock: ReturnType<typeof wallClock>; perfections: Perfection[]; score: BirthScore };
  const finals = new Map<Candidate, Final | null>();
  const finalOf = (candidate: Candidate): Final | null => {
    if (finals.has(candidate)) return finals.get(candidate)!;
    const local = clock(candidate.ms, candidate.place.timezone);
    const { place } = candidate;
    const feature = { profile: { date: local.date, time: local.time, utcOffsetMinutes: local.utcOffsetMinutes,
      latitude: place.latitude, longitude: place.longitude, timezone: place.timezone }, houseSystem: 'whole-sign' as const, timezone };
    const prepared = prepareNatal(engine, feature);
    const perfections = orthodoxDay(engine, prepared, feature, dayFeatures(engine, prepared, feature, date)).perfections;
    const score = scoreOf(perfections, houseRank, day.noonMs);
    const final = score && inAgeRange(local.date) ? { candidate, clock: local, perfections, score } : null;
    finals.set(candidate, final);
    return final;
  };

  // Spread the births, best first: one per place, birth dates apart, perRegion per region.
  const regionNames = [...new Set(places.map(p => p.region))];
  const choose = () => {
    // Equal scores are common among places a few kilometres apart; they are ordered by a hash of the day and the
    // place, not by their order in the list, which would favour the places listed first every day.
    const tie = (c: Candidate) => hash(`${date}|${c.place.id}|${c.ms}`);
    const sorted = [...pool.values()].sort((a, b) => compare(a, b) || tie(a) - tie(b));
    const regions = new Map<string, number>(), dates: number[] = [], usedPlaces = new Set<string>();
    const chosen: Final[] = [];
    for (const candidate of sorted) {
      if (chosen.length === regionNames.length * perRegion) break;
      const { place } = candidate;
      if ((regions.get(place.region) ?? 0) >= perRegion || usedPlaces.has(place.id)) continue;
      const dayNumber = Date.parse(`${clock(candidate.ms, place.timezone).date}T00:00:00Z`) / DAY;
      if (dates.some(d => Math.abs(d - dayNumber) < spreadDays)) continue;
      const final = finalOf(candidate);
      if (!final) continue;
      regions.set(place.region, (regions.get(place.region) ?? 0) + 1);
      dates.push(dayNumber);
      usedPlaces.add(place.id);
      chosen.push(final);
    }
    const shortfall = Object.fromEntries(regionNames.map(r => [r, perRegion - (regions.get(r) ?? 0)]).filter(([, n]) => (n as number) > 0));
    return { chosen, shortfall };
  };

  // Read the best days; while a region is short, read further days, up to three times the depth.
  let read = 0, result = { chosen: [] as Final[], shortfall: {} as Record<string, number> };
  for (let goal = Math.min(depth, days.length); ; goal = Math.min(goal + Math.ceil(depth / 2), days.length, depth * 3)) {
    for (; read < goal; read++) readDay(days[read].ms);
    result = choose();
    if (Object.keys(result.shortfall).length === 0 || read >= Math.min(days.length, depth * 3)) break;
  }

  const births = result.chosen.sort((a, b) => compare(a, b)).map(({ candidate, clock: local, perfections, score }, index): BestBirth => {
    const chart = natalChart(engine, { date: local.date, time: local.time, utcOffsetMinutes: local.utcOffsetMinutes,
      latitude: candidate.place.latitude, longitude: candidate.place.longitude, timezone: candidate.place.timezone });
    const bodies = CHART_BODIES.map(body => planetPosition(engine, chart.julianDayUt!, body));
    return {
      rank: index + 1, crowned: index < crowns, region: candidate.place.region, placeId: candidate.place.id,
      date: local.date, time: local.time, utcOffsetMinutes: local.utcOffsetMinutes, instant: new Date(candidate.ms).toISOString(),
      age: ageOn(local.date, date), score, perfections,
      natal: { longitudes: bodies.map(b => b.longitude), speeds: bodies.map(b => b.speed), node: lunarNode(engine, chart.julianDayUt!).longitude,
        ascendant: chart.ascendant!, midheaven: chart.midheaven! },
    };
  });
  const noonJd = utcToJulianDay(new Date(day.noonMs));
  const today = CHART_BODIES.map(body => planetPosition(engine, noonJd, body));
  return { date, timezone, today: { longitudes: today.map(b => b.longitude), speeds: today.map(b => b.speed), node: lunarNode(engine, noonJd).longitude },
    births, shortfall: result.shortfall };
}
