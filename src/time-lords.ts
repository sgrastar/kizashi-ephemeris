/** Time lords from civil anniversaries and fixed traditional period lengths; no ephemeris is needed. */
import { FortuneInputError, parseDate, localDateTimeToUtc, timezoneFormatter, dayBounds } from './calendar.js';
import type { BirthProfile } from './ephemeris.js';

export const TROPICAL_YEAR_DAYS = 365.2422;
const DAY = 86_400_000;
const YEAR = TROPICAL_YEAR_DAYS * DAY;
export type PlanetLord = 'sun' | 'moon' | 'mercury' | 'venus' | 'mars' | 'jupiter' | 'saturn';
export type Lord = PlanetLord | 'north-node' | 'south-node';
const RULERS: readonly PlanetLord[] = ['mars', 'venus', 'mercury', 'moon', 'sun', 'mercury',
  'venus', 'mars', 'jupiter', 'saturn', 'saturn', 'jupiter'];
const CHALDEAN: readonly PlanetLord[] = ['saturn', 'jupiter', 'mars', 'sun', 'venus', 'mercury', 'moon'];
const YEARS: Record<Lord, number> = { sun: 10, venus: 8, mercury: 13, moon: 9, saturn: 11,
  jupiter: 12, mars: 7, 'north-node': 3, 'south-node': 2 };
const SIGN_PERIODS = [15, 8, 20, 25, 19, 20, 8, 15, 12, 27, 30, 12];
const iso = (ms: number) => new Date(Math.round(ms / 1000) * 1000).toISOString().replace('.000Z', 'Z');
const overlaps = (a: number, b: number, start: number, end: number) => a < end && b > start;
function instant(value: string): number {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new FortuneInputError('期間の日時を ISO 形式で指定してください。');
  return ms;
}
function signIndex(sign: number): void {
  if (!Number.isInteger(sign) || sign < 0 || sign > 11) throw new FortuneInputError('星座は 0 から 11 の整数で指定してください。');
}
function interval(start: string, end: string): [number, number] {
  const a = instant(start), b = instant(end);
  if (b <= a) throw new FortuneInputError('期間の終了は開始より後にしてください。');
  return [a, b];
}

/** Calendar months from the original date, clamped to the destination month's last day. */
export function civilMonths(date: string, months: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  target.setUTCDate(Math.min(day, new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()));
  return target.toISOString().slice(0, 10);
}

function generatedClock(date: string, time: string, timezone: string) {
  const formatter = timezoneFormatter(timezone);
  const wall = Date.parse(`${date}T${time}:00Z`);
  if (!Number.isFinite(wall)) throw new FortuneInputError('期間の日時が不正です。');
  const shown = (ms: number) => {
    const p = Object.fromEntries(formatter.formatToParts(ms).map(part => [part.type, part.value]));
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  };
  const offsets = [...new Set([-36, -12, 0, 12, 36].map(h => {
    const ms = wall + h * 3_600_000;
    return shown(ms) - ms;
  }))];
  const valid = offsets.filter(offset => shown(wall - offset) === wall);
  return { wall, shown, offsets, valid };
}

/** A local civil time, including generated endpoints outside the accepted birth-date range. */
export function civilInstant(date: string, time: string, timezone: string): Date {
  const year = Number(date.slice(0, 4));
  if (year >= 1900 && year <= 2100) return localDateTimeToUtc(date, time, timezone);
  const { wall, offsets, valid } = generatedClock(date, time, timezone);
  return new Date(wall - (valid.length ? Math.max(...valid) : Math.min(...offsets)));
}

/** First instant of a civil day, using calendar.dayBounds and its gap search for generated dates. */
export function civilDayStart(date: string, timezone: string): Date {
  if (date >= '1900-01-01' && date < '2100-12-31') return new Date(dayBounds(date, timezone).s * 1000);
  const { wall, shown, offsets, valid } = generatedClock(date, '00:00', timezone);
  let early = wall - Math.max(...offsets), late = wall - Math.min(...offsets);
  if (valid.length) late = wall - Math.max(...valid);
  else while (late - early > 1000) {
    const mid = early + Math.floor((late - early) / 2000) * 1000;
    if (shown(mid) >= wall) late = mid; else early = mid;
  }
  if (new Date(shown(late)).toISOString().slice(0, 10) !== date) throw new FortuneInputError('この日付は表示タイムゾーンに存在しません。');
  return new Date(late);
}

/** Local noon in the reader's zone, for a snapshot or a generated window endpoint. */
export function civilNoon(date: string, timezone: string): Date {
  return civilInstant(date, '12:00', timezone);
}

export interface ProfectionPeriod {
  age: number; month?: number; sign: number; house: number; lord: PlanetLord; start: string; end: string;
}

/** Annual and monthly profections; anniversaries begin at the first instant of the civil birth-zone day. */
export function profections(profile: BirthProfile, ascendantSign: number, start: string, end: string) {
  parseDate(profile.date); signIndex(ascendantSign);
  const [from, to] = interval(start, end);
  const years: ProfectionPeriod[] = [], months: ProfectionPeriod[] = [];
  const boundary = (m: number) => civilDayStart(civilMonths(profile.date, m), profile.timezone).getTime();
  for (let age = 0; age <= 204; age++) {
    const a = boundary(age * 12);
    if (a >= to) break;
    const b = boundary((age + 1) * 12);
    if (!overlaps(a, b, from, to)) continue;
    const sign = (ascendantSign + age) % 12;
    years.push({ age, sign, house: age % 12 + 1, lord: RULERS[sign], start: iso(a), end: iso(b) });
    for (let month = 0; month < 12; month++) {
      const c = boundary(age * 12 + month), d = boundary(age * 12 + month + 1);
      if (!overlaps(c, d, from, to)) continue;
      const active = (sign + month) % 12;
      months.push({ age, month, sign: active, house: (age + month) % 12 + 1, lord: RULERS[active], start: iso(c), end: iso(d) });
    }
  }
  return { years, months };
}

export interface FirdariaPeriod { lord: Lord; start: string; end: string; majorLord?: PlanetLord }

/** Repeating 75-year firdaria cycles, with seven Chaldean sub-periods in planetary majors. */
export function firdaria(birth: string, sect: 'day' | 'night', start: string, end: string) {
  if (sect !== 'day' && sect !== 'night') throw new FortuneInputError('セクトは day または night で指定してください。');
  const born = instant(birth), [from, to] = interval(start, end);
  const order: Lord[] = sect === 'day' ? ['sun', 'venus', 'mercury', 'moon', 'saturn', 'jupiter', 'mars', 'north-node', 'south-node'] :
    ['moon', 'saturn', 'jupiter', 'mars', 'sun', 'venus', 'mercury', 'north-node', 'south-node'];
  const major: FirdariaPeriod[] = [], sub: FirdariaPeriod[] = [];
  let a = born;
  for (let cycle = 0; a < to && cycle < 100; cycle++) for (const lord of order) {
    const b = a + YEARS[lord] * YEAR;
    if (overlaps(a, b, from, to)) {
      major.push({ lord, start: iso(a), end: iso(b) });
      const index = CHALDEAN.indexOf(lord as PlanetLord);
      if (index >= 0) for (let n = 0; n < 7; n++) {
        const c = a + (b - a) * n / 7, d = a + (b - a) * (n + 1) / 7;
        if (overlaps(c, d, from, to)) sub.push({ lord: CHALDEAN[(index + n) % 7], majorLord: lord as PlanetLord, start: iso(c), end: iso(d) });
      }
    }
    a = b;
  }
  return { major, sub };
}

export interface ReleasingPeriod {
  level: 1 | 2 | 3 | 4; sign: number; start: string; end: string; fromFortune: number; loosed?: true;
}

/** Zodiacal releasing from one lot, with sub-periods clipped at each parent boundary. */
export function zodiacalReleasing(birth: string, lotSign: number, fortuneSign: number, start: string, end: string, levels: 1 | 2 | 3 | 4 = 3): ReleasingPeriod[] {
  signIndex(lotSign); signIndex(fortuneSign);
  if (![1, 2, 3, 4].includes(levels)) throw new FortuneInputError('リリーシングの階層は 1 から 4 で指定してください。');
  const born = instant(birth), [from, to] = interval(start, end);
  const result: ReleasingPeriod[] = [];
  const units = [360 * DAY, 30 * DAY, 2.5 * DAY, 10 * 3_600_000];
  function periods(a: number, parentEnd: number, initial: number, level: 1 | 2 | 3 | 4) {
    let sign = initial, count = 0;
    while (a < parentEnd && a < to) {
      // Only sub-periods loose the bond; L1 has no parent in which to jump.
      const loosed = level > 1 && count === 12;
      if (loosed) sign = (initial + 6) % 12;
      const b = Math.min(parentEnd, a + SIGN_PERIODS[sign] * units[level - 1]);
      if (overlaps(a, b, from, to)) {
        result.push({ level, sign, start: iso(a), end: iso(b), fromFortune: (sign - fortuneSign + 12) % 12 + 1, ...(loosed ? { loosed: true } : {}) });
        if (level < levels) periods(a, b, sign, (level + 1) as 2 | 3 | 4);
      }
      a = b; sign = (sign + 1) % 12; count++;
    }
  }
  periods(born, Infinity, lotSign, 1);
  return result.sort((a, b) => a.start.localeCompare(b.start) || a.level - b.level);
}

export interface PtolemyAge { lord: PlanetLord; fromAge: number; toAge: number | null; start: string; end: string | null }

/** Ptolemy's seven ages, measured in tropical years from the birth instant. */
export function ptolemyAges(birth: string): PtolemyAge[] {
  const born = instant(birth), ages = [0, 4, 14, 22, 41, 56, 68];
  const lords: PlanetLord[] = ['moon', 'mercury', 'venus', 'sun', 'mars', 'jupiter', 'saturn'];
  return ages.map((age, i) => ({ lord: lords[i], fromAge: age, toAge: ages[i + 1] ?? null,
    start: iso(born + age * YEAR), end: i === 6 ? null : iso(born + ages[i + 1] * YEAR) }));
}
