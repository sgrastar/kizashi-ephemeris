# kizashi-ephemeris

The astronomical calculation behind [Kizashi](https://kizashi.day/) (a Garmin watch face and website that read the day's sky against a birth chart), as a Cloudflare Worker of its own.

It computes, and only computes: planetary positions, birth charts in five house systems (Whole Sign, Solar Sign, Placidus, Koch, Equal), the Moon's daily aspects to a birth chart and their exact instants, void-of-course stretches, sign ingresses, lunar phases, and a week's sky. It holds no interpretation text and makes no reading. Kizashi's own Worker calls it over a Cloudflare service binding and turns the plain data it returns into readings.

## License

AGPL-3.0, like the Swiss Ephemeris it uses (`@typescriptify/sweph`, a TypeScript port of Swiss Ephemeris, in Moshier mode, used unchanged). See `LICENSE` and `THIRD_PARTY_NOTICES.md`. The source of the deployed version is this repository: <https://github.com/sgrastar/kizashi-ephemeris>.

## Interface

`src/worker.ts` exports the RPC entrypoint `Ephemeris` (a `WorkerEntrypoint`). Every method takes plain data and returns plain data, `{ ok: true, value }` or `{ ok: false, error: { kind: 'input', message } }` for an input the calculation cannot accept. The shapes are in `src/sky.ts` (`SKY_SCHEMA_VERSION` 1).

| Method | Returns |
|---|---|
| `fortuneSky({profile, houseSystem, timezone, dates, outer, features})` | The birth chart, each day's local-noon positions, and optionally the day's features and lunar aspects |
| `daySky({profile, houseSystem, timezone, date, timeline})` | One day's features and lunar aspects, and optionally its timeline (void stretches, ingress, phase) |
| `quizSky({profile, timezone, today, systems, lookback, maxDays, readings})` | Charts for several house systems, the recent days on which they put the Moon in different houses, and those days' features |
| `weeklySky({sign, weekStart?}, nowMs)` | A week's sky for one Sun sign (Solar Sign houses) |
| `schemaVersion()` | `SKY_SCHEMA_VERSION` |

The Worker's own `fetch` answers `/v1/health`, and redirects `/source/*` (where a source archive used to be) to this repository.

## Develop

```sh
npm ci
npm test           # calculation tests, including comparisons with native Swiss Ephemeris (WASM)
npm run typecheck
npm run deploy
```
