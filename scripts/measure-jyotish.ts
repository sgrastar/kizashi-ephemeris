/** Offline process CPU/wall measurements on a synthetic profile, never a real birth record. */
import { jyotishSky } from '../src/sky.js';
import type { JyotishSkyRequest } from '../src/jyotish-types.js';

const profile = { date: '1990-11-02', time: '07:30', latitude: 35.69, longitude: 139.69, timezone: 'Asia/Tokyo' };
const measurements = [];
for (const scope of ['now', 'lifetime'] as const) for (let run = 0; run < 3; run++) {
  const request: JyotishSkyRequest = { profile, timezone: 'Asia/Tokyo', today: '2026-10-24', scope };
  const cpu = process.cpuUsage(), wall = process.hrtime.bigint();
  const result = jyotishSky(request);
  const elapsed = process.cpuUsage(cpu), wallMs = Number(process.hrtime.bigint() - wall) / 1e6;
  if (!result.ok) throw new Error(result.error.message);
  measurements.push({ scope, run: run + 1, cold: run === 0, cpuMs: (elapsed.user + elapsed.system) / 1000,
    wallMs, responseBytes: Buffer.byteLength(JSON.stringify(result.value)), grahas: result.value.natal.grahas.length,
    ingresses: result.value.gochara.ingresses.length, dasha: { maha: result.value.dasha.maha.length,
      antar: result.value.dasha.antar.length, pratyantar: result.value.dasha.pratyantar.length } });
}
console.log(JSON.stringify({ syntheticProfile: true, timezone: 'Asia/Tokyo', today: '2026-10-24',
  dashaYearDays: 365.25, note: 'Node process CPU; not a Cloudflare production isolate measurement.', measurements }, null, 2));
