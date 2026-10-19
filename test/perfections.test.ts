import test from 'node:test';
import assert from 'node:assert/strict';
import { createEngine, planetPosition, utcToJulianDay, angularSeparation, normalizeDegrees } from '../src/ephemeris.js';
import { addDays, dayBounds } from '../src/calendar.js';
import { prepareNatal, dayFeatures, MAJOR_ASPECTS, sideOf } from '../src/features.js';
import type { DayFeatures } from '../src/features.js';
import { orthodoxDay, houseLords, julianDayToUtc } from '../src/perfections.js';
import type { OrthodoxDay, Perfection } from '../src/perfections.js';


const known = { profile: { date: '1990-01-01', time: '12:00', latitude: 35.68, longitude: 139.69, timezone: 'Asia/Tokyo' }, houseSystem: 'whole-sign' as const, timezone: 'Asia/Tokyo' };
const unknown = { profile: { date: '1978-04-02', time: null, timezone: 'Asia/Tokyo' }, houseSystem: 'solar-sign' as const, timezone: 'Asia/Tokyo' };

/**
 * Independent reference: step the Moon every ten minutes through the civil day
 * and record each (target, aspect) whose exact longitude the Moon passes. This
 * never calls orthodoxDay or moonReaches.
 */
function referencePerfections(engine: ReturnType<typeof createEngine>, points: Record<string, number>, date: string): string[] {
  const b = dayBounds(date, 'Asia/Tokyo');
  const start = utcToJulianDay(new Date(b.s * 1000)), end = utcToJulianDay(new Date(b.e * 1000));
  const found = new Set<string>();
  let prev = planetPosition(engine, start, 'moon').longitude;
  for (let t = start + 10 / 1440; ; t = Math.min(t + 10 / 1440, end)) {
    const now = planetPosition(engine, t, 'moon').longitude;
    for (const [target, longitude] of Object.entries(points)) {
      const angle = target === 'natal.asc' || target === 'natal.mc' ? [0, 180] : MAJOR_ASPECTS.map(a => a.angle);
      for (const a of angle) for (const offset of a === 0 || a === 180 ? [a] : [a, 360 - a]) {
        const goal = normalizeDegrees(longitude + offset);
        // Half-open day: a crossing at the very end belongs to the next day.
        if (normalizeDegrees(goal - prev) < normalizeDegrees(now - prev) || (normalizeDegrees(goal - prev) === 0 && t !== end)) {
          found.add(`${target}:${MAJOR_ASPECTS.find(x => x.angle === a)!.name}`);
        }
      }
    }
    prev = now;
    if (t === end) break;
  }
  return [...found].sort();
}

test('daily perfections are exact, inside the civil day, and agree with a ten-minute crossing reference over 60 days', () => {
  const engine = createEngine();
  try {
    const prepared = prepareNatal(engine, known);
    const chart = prepared.natal;
    const points: Record<string, number> = { 'natal.asc': chart.ascendant!, 'natal.mc': chart.midheaven! };
    for (const p of ['sun', 'moon', 'mercury', 'venus', 'mars'] as const) points[`natal.${p}`] = chart.planets![p].longitude;
    for (const p of ['jupiter', 'saturn'] as const) points[`natal.${p}`] = planetPosition(engine, chart.julianDayUt!, p).longitude;
    let total = 0;
    for (let i = 0; i < 60; i++) {
      const date = addDays('2026-03-01', i);
      const f = dayFeatures(engine, prepared, known, date);
      const day = orthodoxDay(engine, prepared, known, f);
      total += day.perfections.length;
      const b = dayBounds(date, 'Asia/Tokyo');
      for (const p of day.perfections) {
        const at = Date.parse(p.exactAt) / 1000;
        assert.ok(at >= b.s && at < b.e, `${date} ${p.target} ${p.exactAt} outside the day`);
        const moon = planetPosition(engine, utcToJulianDay(new Date(p.exactAt)), 'moon').longitude;
        const angle = MAJOR_ASPECTS.find(a => a.name === p.aspect)!.angle;
        assert.ok(Math.abs(angularSeparation(moon, points[p.target]) - angle) < 1e-3, `${date} ${p.target} ${p.aspect} not exact`);
        if (angle !== 0 && angle !== 180) assert.equal(p.side, sideOf(moon, points[p.target]), `${date} ${p.target} ${p.aspect} side`);
      }
      assert.deepEqual(day.perfections.map(p => `${p.target}:${p.aspect}`).sort(), referencePerfections(engine, points, date), date);
      assert.deepEqual([...day.perfections].sort((a, b) => a.exactAt.localeCompare(b.exactAt)), day.perfections);
    }
    // About 2.5 perfections a day with nine natal points; guards against both sides being empty.
    assert.ok(total > 100, `only ${total} perfections in 60 days`);
  } finally { engine.close(); }
});

test('unknown birth time: no natal Moon or angle perfections and no house lords', () => {
  const engine = createEngine();
  try {
    const prepared = prepareNatal(engine, unknown);
    let total = 0;
    for (let i = 0; i < 60; i++) {
      const f = dayFeatures(engine, prepared, unknown, addDays('2026-03-01', i));
      const day = orthodoxDay(engine, prepared, unknown, f);
      assert.equal(day.lords, null);
      for (const p of day.perfections) {
        assert.ok(!['natal.moon', 'natal.asc', 'natal.mc'].includes(p.target));
        assert.ok(p.natalRange);
      }
      total += day.perfections.length;
    }
    assert.ok(total > 60, 'perfections still occur for unknown-time profiles');
  } finally { engine.close(); }
});

