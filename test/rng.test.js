import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CONFIG,
  generateServerSeed,
  hashRound,
  crashPoint,
  crashPointFromHash,
  verify,
} from '../src/rng.js';

const RTP = DEFAULT_CONFIG.rtp;

test('deterministic: same seed + round always yields the same crash point', () => {
  const seed = generateServerSeed();
  for (const n of [0, 1, 42, 999999]) {
    assert.equal(crashPoint(seed, n), crashPoint(seed, n));
  }
  // Different rounds should (essentially always) differ.
  assert.notEqual(crashPoint(seed, 1), crashPoint(seed, 2));
});

test('commit/reveal: revealed seed reproduces hash and crash point; tampering fails', () => {
  const seed = generateServerSeed();
  const n = 7;
  const commitment = hashRound(seed, n); // published before the round
  const reported = crashPoint(seed, n); // outcome shown after the round

  assert.equal(verify(seed, n, commitment, reported).ok, true);
  // Wrong seed -> hash mismatch -> fails.
  assert.equal(verify(generateServerSeed(), n, commitment, reported).ok, false);
  // Right seed, lied-about crash point -> fails.
  assert.equal(verify(seed, n, commitment, reported + 0.01).ok, false);
});

test('bounds: crash point is always >= 1.00x', () => {
  const seed = generateServerSeed();
  for (let n = 0; n < 10000; n++) {
    assert.ok(crashPoint(seed, n) >= 1.0);
  }
});

// Theoretical win prob / RTP of the profit-haircut curve at cash-out target m.
const winProb = (m, rtp = RTP) => rtp / (rtp + m - 1);
const theoreticalRtp = (m, rtp = RTP) => m * winProb(m, rtp);

test('RTP over 100k rounds matches the profit-haircut curve at every target', () => {
  const ROUNDS = 100000;
  const targets = [1.5, 2.0, 3.0, 10.0];
  const totals = new Map(targets.map((t) => [t, 0]));

  for (let n = 0; n < ROUNDS; n++) {
    const crash = crashPointFromHash(hashRound(generateServerSeed(), n));
    for (const t of targets) {
      // Cash-out at t: win t x stake if the round reaches t, else lose the stake.
      if (crash >= t) totals.set(t, totals.get(t) + t);
    }
  }

  // Realized RTP must track the exact curve RTP(m)=m*rtp/(rtp+m-1). Tolerance is
  // 4 standard errors (return SD at target t is t*sqrt(p(1-p))), so the assertion
  // is statistically sound across the heavy tail rather than a flat, flaky margin.
  for (const t of targets) {
    const realized = totals.get(t) / ROUNDS;
    const p = winProb(t);
    const se = t * Math.sqrt((p * (1 - p)) / ROUNDS);
    assert.ok(
      Math.abs(realized - theoreticalRtp(t)) < 4 * se,
      `target ${t}x: realized RTP ${realized.toFixed(4)} not within 4σ (${(4 * se).toFixed(4)}) of ${theoreticalRtp(t).toFixed(4)}`,
    );
    assert.ok(realized <= 1, `target ${t}x: RTP ${realized.toFixed(4)} must not exceed 1 (house edge)`);
  }
});

test('instant-crash rate sits near ~1% (from flooring, decoupled from edge)', () => {
  // Charging the edge as a profit haircut means the ONLY 1.00x crashes are the
  // ones two-decimal flooring produces near the bottom of the curve — ~1%,
  // independent of `rtp`. Contrast the old constant-RTP curve's ~4%.
  const ROUNDS = 100000;
  let instant = 0;
  for (let n = 0; n < ROUNDS; n++) {
    if (crashPointFromHash(hashRound(generateServerSeed(), n)) === 1.0) instant++;
  }
  const rate = instant / ROUNDS;
  assert.ok(rate > 0.006 && rate < 0.02, `instant-crash rate ${(rate * 100).toFixed(2)}% out of expected ~1% band`);
});

test('instantCrashRate knob forces a higher instant rate independently', () => {
  const ROUNDS = 50000;
  const cfg = { rtp: RTP, instantCrashRate: 0.05 };
  let instant = 0;
  for (let n = 0; n < ROUNDS; n++) {
    if (crashPointFromHash(hashRound(generateServerSeed(), n), cfg) === 1.0) instant++;
  }
  const rate = instant / ROUNDS;
  // ~5% forced + ~1% from flooring the renormalized tail.
  assert.ok(rate > 0.05 && rate < 0.075, `forced instant rate ${(rate * 100).toFixed(2)}% out of band`);
});
