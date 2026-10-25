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

## Jyotish RPC (prototype calculation)

`jyotishSky({profile, timezone, today, scope, residence?, dashaYearDays?})` is an additional service-binding RPC. Types are exported from `kizashi-ephemeris/jyotish-sky` and `src/sky.ts`. Existing tropical RPCs keep their output shapes and defaults.

Defaults are Lahiri (`SE_SIDM_LAHIRI`), mean Rahu with Ketu exactly opposite, Whole Sign houses from the sidereal Ascendant, and a 365.25-day Vimshottari year. `dashaYearDays` accepts finite values between 300 and 400, including 360 and 365.2422. Signs are zero-based; houses, nakshatras and padas are one-based. Uranus, Neptune and Pluto are reference positions only and do not enter traditional rulership, dignity or dasha calculations. Combustion limits and degree-specific moolatrikona ranges are explicit in `src/jyotish-natal.ts`; nodal dignity is omitted because conventions differ.

`now` covers local noon twelve civil months before today through local noon thirty-six months after it. `lifetime` covers the birth instant through the ninetieth civil anniversary. Windows are half-open. Dasha lists contain full periods overlapping the window, with maha/antar/pratyantar for `now` and maha/antar for `lifetime`; `current` includes all three levels. Returned second-rounded period boundaries are also the boundaries used by `current`. Gochara periods are clipped to the window; retrograde re-entry can repeat a Sade Sati phase. Returns list individual sidereal crossings, including retrograde passages.

Without a birth time, the local-noon positions and dasha schedule are approximate representatives. Lagna and lagna-house fields are absent; `moonHouse` still expresses Chandra Lagna. `natal.moonRange` and `dasha.uncertainty` include the actual local day's midnight/next-midnight endpoints (23 or 25 hours on DST changes), both endpoint schedules, starting-lord alternatives and major-period start/end envelopes. These two endpoint schedules do not imply that every intermediate birth has the same starting lord.

The sidereal engine flags explicitly include `NONUT`, matching native Swiss Ephemeris behavior. The reported `natal.ayanamsa` includes nutation, matching native `swe_get_ayanamsa_ex_ut` with Moshier flags; the mean value is used for mean-equinox positions and the nutation-inclusive value for the Ascendant conversion. This corrects a flag/convention discrepancy in the unchanged TypeScript dependency.

Offline comparison of 1,008 positions across 1900-2100 found maximum native-C differences of 0.00906043 degrees in longitude, 0.01348705 degrees in latitude and 0.00116208 degrees/day in speed. Ayanamsa and Ascendant agree within 6e-11 degrees. The longitude difference matches the dependency's existing tropical NONUT residual within 3e-11 degrees. Transport rounding to 0.0001 degrees is not an accuracy claim: deliberately sampling just after a native sign boundary produces different sign/nakshatra/pada/D9 classifications. Treat values close to such boundaries as limited by this measured prototype precision. `scripts/compare-jyotish-native.ts` reproduces both the matched-frame control and these boundary probes without network access.

## Develop

```sh
npm ci
npm test           # calculation tests, including comparisons with native Swiss Ephemeris (WASM)
npm run typecheck
npm run deploy
```
