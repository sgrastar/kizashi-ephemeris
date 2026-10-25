import test from 'node:test';
import assert from 'node:assert/strict';
import { compareNativeJyotish, nativeFlagEvidence } from '../scripts/compare-jyotish-native.js';

test('matched Lahiri UT/flags isolate inherited residuals while ayanamsa and lagna agree with native C', async context => {
  const result = await compareNativeJyotish();
  assert.equal(result.positions, 1008);
  assert.equal(result.translatedReturnedFlags, 65860);
  // Tight frame controls distinguish our conversion from the separately measured underlying tropical-port error.
  assert.ok(result.maxima.ayanamsa < 1e-8);
  assert.ok(result.maxima.meanAyanamsa < 1e-8);
  assert.ok(result.maxima.lagna < 1e-8);
  assert.ok(result.maxima.inheritedResidualMismatch < 1e-8);
  assert.ok(result.maxima.longitude < .01);
  assert.ok(result.maxima.longitude > .005, 'Keep the measured library residual visible instead of implying exact native parity.');
  assert.ok(result.boundaryProbes.some(p => JSON.stringify(p.native) !== JSON.stringify(p.translated)), 'Deliberate boundary probes must expose the residual classification limitation.');
  context.diagnostic(JSON.stringify({ maxima: result.maxima, gridBoundaryDifferences: result.boundaryClassificationDifferences.length,
    boundaryProbes: result.boundaryProbes }));
});

test('native C adds NONUT to SIDEREAL and distinguishes true/mean ayanamsa flags', async () => {
  const flags = await nativeFlagEvidence();
  assert.equal(flags.requestedFlags, 65796);
  assert.equal(flags.returnedFlags, 65860);
  assert.equal(flags.ayanamsas[0].returnedFlags, 4);
  assert.equal(flags.ayanamsas[1].returnedFlags, 68);
  assert.ok(Math.abs(flags.ayanamsas[0].value - 23.853222486029065) < 1e-10);
  assert.ok(Math.abs(flags.ayanamsas[1].value - 23.857092353708822) < 1e-10);
});
