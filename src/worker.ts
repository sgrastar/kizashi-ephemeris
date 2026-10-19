/**
 * kizashi-ephemeris: the astronomical calculation behind Kizashi, as a Worker of its own (AGPL-3.0, like the
 * Swiss Ephemeris it uses). Other Workers call it over a service binding; each method takes plain data and
 * returns plain data (src/sky.ts). It reads no interpretation text and makes no reading.
 *
 * Its source is published at /source/ on the sites that use it (served from this Worker's static assets).
 */
import { WorkerEntrypoint } from 'cloudflare:workers';
import { fortuneSky, daySky, quizSky, weeklySky, SKY_SCHEMA_VERSION } from './sky.js';
import type { FortuneSkyRequest, DaySkyRequest, QuizSkyRequest, WeeklySkyInput } from './sky.js';

interface Env { ASSETS: Fetcher }

function serve(request: Request, env: Env): Promise<Response> | Response {
  const url = new URL(request.url);
  if (url.pathname === '/v1/health') {
    return Response.json({ status: 'ok', application: 'kizashi-ephemeris', schemaVersion: SKY_SCHEMA_VERSION,
      license: 'AGPL-3.0', source: '/source/kizashi-ephemeris-source.tar.gz' });
  }
  // The source archive and its checksum, for anyone who uses a site built on this Worker.
  if (url.pathname.startsWith('/source/')) return env.ASSETS.fetch(request);
  return Response.json({ error: 'not_found' }, { status: 404 });
}

export class Ephemeris extends WorkerEntrypoint<Env> {
  /** Requests forwarded by the sites that use this Worker (its source archive). */
  fetch(request: Request) { return serve(request, this.env); }
  schemaVersion() { return SKY_SCHEMA_VERSION; }
  fortuneSky(request: FortuneSkyRequest) { return fortuneSky(request); }
  daySky(request: DaySkyRequest) { return daySky(request); }
  quizSky(request: QuizSkyRequest) { return quizSky(request); }
  weeklySky(input: WeeklySkyInput, nowMs: number) { return weeklySky(input, nowMs); }
}

export default {
  fetch(request, env) { return serve(request, env); },
} satisfies ExportedHandler<Env>;
