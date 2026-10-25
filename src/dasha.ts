/** Fixed-day Vimshottari periods. No astronomical engine or reading text. */
import { FortuneInputError } from './calendar.js';
import { DASHA_LORDS, nakshatra } from './jyotish-natal.js';
import type { GrahaName, DashaPeriod, DashaSchedule } from './jyotish-types.js';

/** Julian years are the requested default; callers can select another conventional fixed-day year. */
export const DASHA_YEAR_DAYS = 365.25;
export const DASHA_YEARS: Readonly<Record<GrahaName, number>> = { ketu: 7, venus: 20, sun: 6, moon: 10,
  mars: 7, rahu: 18, jupiter: 16, saturn: 19, mercury: 17 };
const DAY = 86_400_000;
const iso = (ms: number) => new Date(Math.round(ms / 1000) * 1000).toISOString().replace('.000Z', 'Z');

export function validateDashaYear(days: number): void {
  // Bound work as well as rejecting nonsensical units; includes 360, 365.2422 and 365.25 conventions.
  if (!Number.isFinite(days) || days < 300 || days > 400) throw new FortuneInputError('ダシャーの1年は300〜400日の範囲で指定してください。');
}

export function vimshottari(birth: string, moonLongitude: number, start: string, end: string, today: string,
  yearDays = DASHA_YEAR_DAYS, levels: 2 | 3 = 3): DashaSchedule {
  validateDashaYear(yearDays);
  const born = Date.parse(birth), from = Date.parse(start), to = Date.parse(end), now = Date.parse(today);
  if (![born, from, to, now, moonLongitude].every(Number.isFinite) || to <= from) throw new FortuneInputError('ダシャーの期間と月の位置を確認してください。');
  const moon = nakshatra(moonLongitude), year = yearDays * DAY, firstLord = moon.lord;
  const firstStart = born - moon.fraction * DASHA_YEARS[firstLord] * year;
  const result: DashaSchedule = { yearDays,
    birthBalance: { lord: firstLord, nakshatra: moon.index, elapsedFraction: moon.fraction,
      remainingYears: DASHA_YEARS[firstLord] * (1 - moon.fraction), start: iso(firstStart), end: iso(firstStart + DASHA_YEARS[firstLord] * year) },
    maha: [], antar: [], pratyantar: [], current: { maha: null, antar: null, pratyantar: null } };
  // Classify against the same second-rounded boundaries that callers receive, including at fractional sub-period edges.
  const second = (ms: number) => Math.round(ms / 1000) * 1000;
  const overlaps = (a: number, b: number) => second(a) < to && second(b) > from;
  const current = (a: number, b: number) => second(a) <= now && now < second(b);
  const append = (level: 1 | 2 | 3, lord: GrahaName, mahaLord: GrahaName, antarLord: GrahaName | undefined, a: number, b: number) => {
    const period: DashaPeriod = { level, lord, mahaLord, ...(antarLord ? { antarLord } : {}), start: iso(a), end: iso(b) };
    const key = level === 1 ? 'maha' : level === 2 ? 'antar' : 'pratyantar';
    if (level <= levels && overlaps(a, b)) result[key].push(period);
    if (current(a, b)) result.current[key] = period;
  };
  let a = firstStart, index = DASHA_LORDS.indexOf(firstLord);
  for (let count = 0; a < Math.max(to, now + 1000) && count < 40; count++, index = (index + 1) % 9) {
    const maha = DASHA_LORDS[index], b = a + DASHA_YEARS[maha] * year;
    if (overlaps(a, b) || current(a, b)) {
      append(1, maha, maha, undefined, a, b);
      let c = a;
      for (let n = 0; n < 9; n++) {
        const antar = DASHA_LORDS[(index + n) % 9], d = n === 8 ? b : c + (b - a) * DASHA_YEARS[antar] / 120;
        if (overlaps(c, d) || current(c, d)) {
          append(2, antar, maha, antar, c, d);
          let e = c;
          for (let k = 0; k < 9; k++) {
            const lord = DASHA_LORDS[(index + n + k) % 9], f = k === 8 ? d : e + (d - c) * DASHA_YEARS[lord] / 120;
            if (levels === 3 && overlaps(e, f) || current(e, f)) append(3, lord, maha, antar, e, f);
            e = f;
          }
        }
        c = d;
      }
    }
    a = b;
  }
  return result;
}
