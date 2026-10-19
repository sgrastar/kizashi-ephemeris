/** Civil-date handling. Birth and display zones are independent IANA zones. */
export class FortuneInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FortuneInputError';
  }
}

export interface CivilDate {
  year: number;
  month: number;
  day: number;
}

export function parseDate(value: unknown): CivilDate {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new FortuneInputError('日付は YYYY-MM-DD で指定してください。');
  }
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1900 || year > 2100) {
    throw new FortuneInputError('試作版の日付範囲は 1900 年から 2100 年です。');
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new FortuneInputError('実在する日付を指定してください。');
  }
  return { year, month, day };
}

export function addDays(value: string, days: number): string {
  const { year, month, day } = parseDate(value);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  const result = date.toISOString().slice(0, 10);
  parseDate(result);
  return result;
}

/** A fixed UTC offset in minutes (east-positive) as a zone id, e.g. 330 -> "UTC+05:30", 0 -> "UTC+00:00". */
export function fixedOffsetZone(minutes: number): string {
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  return `UTC${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}
const FIXED_OFFSET_ZONE = /^UTC([+-]\d{2}:\d{2})$/;

/**
 * A birth zone nobody gave: no zone name, coordinates or offset. It only bounds an
 * unknown-time birth date, as the span in which that date was current somewhere
 * (UTC+14 to UTC-12), so the Sun-sign candidates cover every place on Earth.
 */
export const ANY_BIRTH_ZONE = 'any';

/** A formatter for an IANA zone or a fixed-offset zone id ("UTC+05:30"), which Intl takes as "+05:30". */
export function timezoneFormatter(timezone: unknown): Intl.DateTimeFormat {
  if (typeof timezone !== 'string' || timezone.length > 100) {
    throw new FortuneInputError('タイムゾーンを IANA 名で指定してください。');
  }
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: FIXED_OFFSET_ZONE.exec(timezone)?.[1] ?? timezone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hourCycle: 'h23',
    });
  } catch {
    throw new FortuneInputError('タイムゾーンが不正です。');
  }
}

function localFields(instant: number, formatter: Intl.DateTimeFormat): number[] {
  const parts = Object.fromEntries(formatter.formatToParts(instant).map(p => [p.type, p.value]));
  return ['year', 'month', 'day', 'hour', 'minute', 'second'].map(k => Number(parts[k]));
}

/** The zone's offsets in force within ±36 hours of a wall-clock minute (before and after any transition). */
function nearbyOffsets(wall: number, formatter: Intl.DateTimeFormat): number[] {
  const offsets = new Set<number>();
  // ± 36 hours also covers date-line transitions.
  for (const deltaHours of [-36, -12, 0, 12, 36]) {
    const probe = wall + deltaHours * 3_600_000;
    const [y, m, d, h, min, sec] = localFields(probe, formatter);
    offsets.add((Date.UTC(y, m - 1, d, h, min, sec) - probe) / 60_000);
  }
  return [...offsets];
}

/**
 * UTC offsets (minutes, east-positive) under which this wall-clock minute
 * exists in the zone: none in a DST gap, two in a fold. Expects a valid
 * date and HH:mm time.
 */
export function wallClockOffsets(date: string, time: string, formatter: Intl.DateTimeFormat): number[] {
  const { year, month, day } = parseDate(date);
  const [hour, minute] = time.split(':').map(Number);
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  // Every candidate is checked against the zone.
  return nearbyOffsets(wall, formatter).filter(offset => {
    const [y, m, d, h, min, sec] = localFields(wall - offset * 60_000, formatter);
    return y === year && m === month && d === day && h === hour && min === minute && sec === 0;
  });
}

/**
 * Resolve a wall-clock minute using the runtime's IANA history (Intl), which
 * includes past DST rules. An explicit UTC offset (east-positive minutes) is the
 * offset the clock actually showed at birth and is used as given: it picks one of
 * a repeated hour, and it corrects births the zone history gets wrong (zones that
 * agree since 1970 share one history, so older local rules can be missing). Without one, the "compatible" rule
 * of RFC 5545 and Temporal applies: a time skipped by a DST gap is read with
 * the offset before the gap (so 02:30 becomes 03:30), and a repeated time
 * takes the earlier instant. A watch cannot ask which repeated hour was
 * meant, so it sends an offset only when the person chose one.
 */
export function localDateTimeToUtc(
  date: string,
  time: string,
  timezone: string,
  utcOffsetMinutes?: number,
  formatter?: Intl.DateTimeFormat,
): Date {
  const { year, month, day } = parseDate(date);
  if (typeof time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    throw new FortuneInputError('出生時刻は HH:mm で指定してください。');
  }
  const [hour, minute] = time.split(':').map(Number);
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  if (utcOffsetMinutes !== undefined &&
      (!Number.isInteger(utcOffsetMinutes) || Math.abs(utcOffsetMinutes) > 14 * 60)) {
    throw new FortuneInputError('UTC オフセットは -840 から 840 の整数で指定してください。');
  }
  if (utcOffsetMinutes !== undefined) return new Date(wall - utcOffsetMinutes * 60_000);
  formatter ??= timezoneFormatter(timezone);
  const valid = wallClockOffsets(date, time, formatter);
  // Earlier instant = larger offset. In a gap the clocks jumped forward, so
  // the offset before it is the smaller of the offsets around it.
  const offset = valid.length > 0 ? Math.max(...valid) : Math.min(...nearbyOffsets(wall, formatter));
  return new Date(wall - offset * 60_000);
}

/** UTC boundaries of a display-zone civil day (end is exclusive). */
export function dayBounds(date: string, timezone: string, formatter?: Intl.DateTimeFormat) {
  if (timezone === ANY_BIRTH_ZONE) {
    const { year, month, day } = parseDate(date);
    const midnight = Date.UTC(year, month - 1, day) / 1000;
    return { s: midnight - 14 * 3600, e: midnight + 36 * 3600 };
  }
  formatter ??= timezoneFormatter(timezone);
  // A day starts at its first instant: where DST begins at midnight
  // (Santiago, Cairo, Havana ...) that is 01:00, so the day lasts 23 hours.
  // A civil date the zone skipped entirely (Apia, 2011-12-30) is rejected.
  const start = startOfDay(date, formatter), end = startOfDay(addDays(date, 1), formatter);
  if (end <= start) throw new FortuneInputError('この日付は表示タイムゾーンに存在しません。');
  return { s: start / 1000, e: end / 1000 };
}

/** The first instant (UTC ms) of a civil date in the zone. */
function startOfDay(date: string, formatter: Intl.DateTimeFormat): number {
  const { year, month, day } = parseDate(date);
  const wall = Date.UTC(year, month - 1, day);
  const valid = wallClockOffsets(date, '00:00', formatter);
  if (valid.length > 0) return wall - Math.max(...valid) * 60_000;
  // Midnight fell in a gap, which may also have started the evening before
  // (Toronto, 1919-03-31: 23:30 -> 00:30). Find the transition to the second:
  // `late` reads midnight with the offset before the gap (already this date),
  // `early` with the offset after it (still the previous date).
  const offsets = nearbyOffsets(wall, formatter);
  let early = wall - Math.max(...offsets) * 60_000, late = wall - Math.min(...offsets) * 60_000;
  const isDate = (instant: number) => {
    const [y, m, d] = localFields(instant, formatter);
    return Date.UTC(y, m - 1, d) >= wall;
  };
  while (late - early > 1000) {
    const mid = early + Math.floor((late - early) / 2000) * 1000;
    if (isDate(mid)) late = mid; else early = mid;
  }
  return late;
}
