import test from 'node:test';
import assert from 'node:assert/strict';
import { nakshatra, navamsaSign, isCombust, jyotishDignity, fromSign } from '../src/jyotish-natal.js';
import { vimshottari, DASHA_YEARS } from '../src/dasha.js';
import { saturnState } from '../src/jyotish-gochara.js';

const DAY = 86_400_000;
const birth = '2000-01-01T12:00:00Z';

test('nakshatra and pada are half-open at zero, 13°20′ and the end of the zodiac', () => {
  assert.deepEqual([nakshatra(0).index, nakshatra(0).pada, nakshatra(0).lord], [1, 1, 'ketu']);
  assert.equal(nakshatra(40 / 3 - 1e-7).index, 1);
  assert.deepEqual([nakshatra(40 / 3).index, nakshatra(40 / 3).pada, nakshatra(40 / 3).lord], [2, 1, 'venus']);
  assert.equal(nakshatra(10 / 3 - 1e-7).pada, 1);
  assert.equal(nakshatra(10 / 3).pada, 2);
  assert.equal(nakshatra(360 - 1e-7).index, 27);
  assert.equal(nakshatra(360).index, 1);
  assert.equal(nakshatra(-1e-7).index, 27);
});

test('D9 respects movable, fixed and dual starts and every one of the 108 boundaries', () => {
  assert.equal(navamsaSign(0), 0);
  assert.equal(navamsaSign(30), 9);
  assert.equal(navamsaSign(60), 6);
  assert.equal(navamsaSign(90), 3);
  for (let i = 1; i < 108; i++) {
    const lon = i * 10 / 3;
    assert.equal(navamsaSign(lon - 1e-7), (i - 1) % 12);
    assert.equal(navamsaSign(lon + 1e-7), i % 12);
  }
});

test('combustion uses circular separation and distinct retrograde limits, excluding nodes', () => {
  assert.equal(isCombust('mercury', 13, 0, false), true);
  assert.equal(isCombust('mercury', 13, 0, true), false);
  assert.equal(isCombust('venus', 351, 0, false), true);
  assert.equal(isCombust('venus', 351, 0, true), false);
  assert.equal(isCombust('moon', 12, 0, false), false);
  assert.equal(isCombust('rahu', 0, 0, true), false);
  assert.equal(isCombust('ketu', 0, 0, true), false);
});

test('degree-specific moolatrikona, exaltation and own-sign boundaries are explicit', () => {
  assert.equal(jyotishDignity('moon', 32.999), 'exaltation');
  assert.equal(jyotishDignity('moon', 33), 'moolatrikona');
  assert.equal(jyotishDignity('mercury', 164.999), 'exaltation');
  assert.equal(jyotishDignity('mercury', 165), 'moolatrikona');
  assert.equal(jyotishDignity('mercury', 170), 'own-sign');
  assert.equal(jyotishDignity('sun', 180), 'debilitation');
  assert.equal(jyotishDignity('rahu', 30), null);
});

test('Vimshottari hand calculation: Bharani midpoint leaves ten Venus years', () => {
  const d = vimshottari(birth, 20, birth, '2120-01-01T12:00:00Z', birth);
  assert.equal(d.birthBalance.lord, 'venus');
  assert.equal(d.birthBalance.remainingYears, 10);
  assert.equal(Date.parse(d.birthBalance.start), Date.parse(birth) - 10 * 365.25 * DAY);
  assert.equal(Date.parse(d.birthBalance.end), Date.parse(birth) + 10 * 365.25 * DAY);
  assert.equal(d.current.maha!.lord, 'venus');
  assert.equal(d.current.antar!.lord, 'rahu'); // Venus sub-period weights 20+6+10+7=43 precede Rahu's 18.
});

test('all three levels divide complete parent periods in the proportional 120-year sequence', () => {
  assert.equal(Object.values(DASHA_YEARS).reduce((sum, years) => sum + years, 0), 120);
  const d = vimshottari(birth, 40 / 3, birth, '2021-01-01T00:00:00Z', birth);
  const venus = d.maha[0], sub = d.antar.filter(p => p.mahaLord === 'venus');
  assert.equal(Date.parse(venus.end) - Date.parse(venus.start), 20 * 365.25 * DAY);
  assert.equal(sub.length, 9);
  assert.equal(sub[0].lord, 'venus');
  assert.equal(sub[0].start, venus.start);
  assert.equal(sub.at(-1)!.end, venus.end);
  assert.equal(Date.parse(sub[0].end) - Date.parse(sub[0].start), 1217.5 * DAY);
  for (let i = 1; i < sub.length; i++) assert.equal(sub[i - 1].end, sub[i].start);
  const thirds = d.pratyantar.filter(p => p.mahaLord === 'venus' && p.antarLord === 'venus');
  assert.equal(thirds.length, 9);
  assert.equal(thirds[0].start, sub[0].start);
  assert.equal(thirds.at(-1)!.end, sub[0].end);
  assert.ok(Math.abs((Date.parse(thirds[0].end) - Date.parse(thirds[0].start)) / DAY - 1217.5 / 6) < 1 / 86400);
  const boundary = sub[0].end;
  assert.equal(vimshottari(birth, 40 / 3, birth, '2021-01-01T00:00:00Z', boundary).current.antar!.lord, 'sun');
});

test('switching the dasha year changes periods proportionally without changing the lunar seed', () => {
  const a = vimshottari(birth, 20, birth, '2090-01-01T00:00:00Z', birth, 365.25);
  const b = vimshottari(birth, 20, birth, '2090-01-01T00:00:00Z', birth, 360);
  assert.equal(a.birthBalance.lord, b.birthBalance.lord);
  assert.equal(Date.parse(a.birthBalance.end) - Date.parse(b.birthBalance.end), 10 * 5.25 * DAY);
  assert.throws(() => vimshottari(birth, 0, birth, '2001-01-01T00:00:00Z', birth, 0));
  assert.throws(() => vimshottari(birth, 0, birth, '2001-01-01T00:00:00Z', birth, NaN));
});

test('current dasha changes at every returned second-rounded boundary, including fractional seeds', () => {
  const end = '2020-01-01T00:00:00Z';
  const schedule = vimshottari(birth, 123.123, birth, end, birth);
  for (const period of schedule.pratyantar) {
    const after = vimshottari(birth, 123.123, birth, end, period.end);
    assert.equal(after.current.pratyantar!.start, period.end);
  }
});

test('Sade Sati has three Moon-relative phases, Ashtama Shani is the eighth sign', () => {
  assert.deepEqual(saturnState(12), { kind: 'sade-sati', phase: 'rising' });
  assert.deepEqual(saturnState(1), { kind: 'sade-sati', phase: 'peak' });
  assert.deepEqual(saturnState(2), { kind: 'sade-sati', phase: 'setting' });
  assert.deepEqual(saturnState(8), { kind: 'ashtama-shani' });
  assert.equal(saturnState(3), null);
  assert.equal(fromSign(359, 0), 12);
  assert.equal(fromSign(0, 11), 2);
});
