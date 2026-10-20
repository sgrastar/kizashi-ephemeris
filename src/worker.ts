/**
 * kizashi-ephemeris: the astronomical calculation behind Kizashi, as a Worker of its own (AGPL-3.0, like the
 * Swiss Ephemeris it uses). Other Workers call it over a service binding; each method takes plain data and
 * returns plain data (src/sky.ts). It reads no interpretation text and makes no reading.
 *
 * Its source is this repository: https://github.com/sgrastar/kizashi-ephemeris
 */
import { WorkerEntrypoint } from 'cloudflare:workers';
import { fortuneSky, daySky, quizSky, weeklySky, SKY_SCHEMA_VERSION } from './sky.js';
import type { FortuneSkyRequest, DaySkyRequest, QuizSkyRequest, WeeklySkyInput } from './sky.js';

const SOURCE_URL = 'https://github.com/sgrastar/kizashi-ephemeris';

function serve(request: Request): Response {
  const url = new URL(request.url);
  if (url.pathname === '/v1/health') {
    return Response.json({ status: 'ok', application: 'kizashi-ephemeris', schemaVersion: SKY_SCHEMA_VERSION,
      license: 'AGPL-3.0', source: SOURCE_URL });
  }
  // The source archive once served here moved to the repository.
  if (url.pathname.startsWith('/source/')) return Response.redirect(SOURCE_URL, 301);
  return Response.json({ error: 'not_found' }, { status: 404 });
}

export class Ephemeris extends WorkerEntrypoint {
  fetch(request: Request) { return serve(request); }
  schemaVersion() { return SKY_SCHEMA_VERSION; }
  fortuneSky(request: FortuneSkyRequest) { return fortuneSky(request); }
  daySky(request: DaySkyRequest) { return daySky(request); }
  quizSky(request: QuizSkyRequest) { return quizSky(request); }
  weeklySky(input: WeeklySkyInput, nowMs: number) { return weeklySky(input, nowMs); }
}

export default {
  fetch(request) { return serve(request); },
} satisfies ExportedHandler;
