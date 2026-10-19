# Third-party notices

kizashi-ephemeris is provided under the GNU Affero General Public License, version 3. The complete license text is in `LICENSE`. The source archive contains the Worker's code, tests, dependency lockfile, and build instructions. Its npm dependencies are obtained at the exact versions and integrity hashes recorded in `package-lock.json`.

## Runtime astronomy library

- Package: `@typescriptify/sweph` **1.0.4**.
- License declared by the package: **AGPL-3.0**.
- Source: <https://github.com/typescriptify/sweph>. Version 1.0.4 is commit `d787c55d190bd9ae93c1a53992c889d400bc971f`: <https://github.com/TypeScriptify/sweph/tree/d787c55d190bd9ae93c1a53992c889d400bc971f> (its `package.json` declares 1.0.4; npm published 1.0.4 on 2026-04-24, 44 seconds after this commit). That tree holds the library's TypeScript source and build settings; `npm ci` installs the published build, pinned by the integrity hash in `package-lock.json`.
- Published package: <https://www.npmjs.com/package/@typescriptify/sweph/v/1.0.4>.
- The project uses the package unchanged. It is a TypeScript port of Swiss Ephemeris. Upstream Swiss Ephemeris is by Astrodienst AG, Dieter Koch, and Alois Treindl: <https://github.com/aloistr/swisseph> and <https://www.astro.com/swisseph/>.
- `LICENSE` is the license text of this package.

## Independent calculation reference used in tests

- Package: `@kuntay/swisseph` **0.2.2**; development and test dependency only.
- License declared by the package: **AGPL-3.0-or-later**.
- Source: <https://github.com/kuntayerkus/swisseph-wasm>, package `packages/core`.
- Published package: <https://www.npmjs.com/package/@kuntay/swisseph/v/0.2.2>.
- Its upstream notice credits Swiss Ephemeris **2.10.03**, copyright (C) 1997–2021 Astrodienst AG, Switzerland, and authors Dieter Koch and Alois Treindl. The project uses it unchanged for comparison tests; it is not part of the running Worker.
