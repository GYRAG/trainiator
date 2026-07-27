// Trainiator — provably-fair crash-point generator.
//
// This is the ONLY place the crash outcome is decided. It is pure, deterministic
// given (serverSeed, roundNumber, config), and must stay provably fair:
// nothing in Part 2 (retention mechanics) may reach in here and bend the odds.
//
// Commit/reveal flow:
//   1. Server picks a secret `serverSeed` (32 random bytes) per round.
//   2. Before the round, it PUBLISHES `hashRound(seed, n)` — the commitment.
//      SHA-256 is one-way, so players can't derive the seed or the crash point.
//   3. The crash point is derived from that same hash, so the outcome is locked
//      in at commit time and cannot be changed once bets are placed.
//   4. After the round, the server REVEALS `serverSeed`. Anyone can recompute the
//      hash, confirm it matches the commitment, and re-derive the crash point.

import { createHash, randomBytes } from 'node:crypto';

// House edge lives here, and ONLY here.
//
//   rtp  = fraction of PROFIT (the part above 1.00x) that is paid out.
//          The edge is charged as a haircut on profit, NOT as instant crashes,
//          so it spreads smoothly across the curve instead of concentrating in
//          1.00x rug-pulls. Overall RTP is target-dependent:
//          RTP(m) = m*rtp / (rtp + m - 1)  -> ~100% near 1.00x, easing down to
//          `rtp` at high multipliers. rtp=0.94 => ~97% RTP on typical (2x) play.
//
//   instantCrashRate = forced probability of an instant 1.00x crash. Default 0,
//          because two-decimal flooring alone already yields ~1% instant crashes.
//          Set it only to pin a different instant rate independently of `rtp`.
export const DEFAULT_CONFIG = { rtp: 0.94, instantCrashRate: 0 };

const TWO_POW_52 = 2 ** 52; // 13 hex chars = 52 bits of entropy.

/** Fresh secret seed for a round: 32-byte hex string. */
export function generateServerSeed() {
  return randomBytes(32).toString('hex');
}

/** The public commitment for a round: SHA256(serverSeed + ":" + roundNumber). */
export function hashRound(serverSeed, roundNumber) {
  return createHash('sha256').update(`${serverSeed}:${roundNumber}`).digest('hex');
}

/**
 * Derive the crash multiplier from a round hash.
 *
 * h = (first 13 hex chars, as an int) / 2^52  ->  uniform in [0, 1).
 *   1. An `instantCrashRate` slice of h maps straight to a 1.00x instant crash.
 *   2. The rest is renormalized to u, and X = 1/(1-u) is the FAIR (zero-edge)
 *      crash curve: X >= 1, median 2x, heavy tail.
 *   3. The house edge is a haircut on profit: keep only `rtp` of (X - 1).
 *      crash = 1 + rtp*(X - 1), floored to two decimals (>= 1.00x).
 *
 * Result: RTP(m) = m*rtp / (rtp + m - 1) at every cash-out target m, and
 * RTP(m) <= 1 for all m >= 1 (house is never at a disadvantage).
 */
export function crashPointFromHash(hash, config = DEFAULT_CONFIG) {
  const { rtp, instantCrashRate = 0 } = config;
  const h = parseInt(hash.slice(0, 13), 16) / TWO_POW_52; // [0, 1)
  if (h < instantCrashRate) return 1.0;

  const u = (h - instantCrashRate) / (1 - instantCrashRate); // renormalize to [0, 1)
  const fair = 1 / (1 - u); // zero-edge curve: >= 1, median 2x
  const crash = 1 + rtp * (fair - 1); // haircut the profit
  return Math.max(1.0, Math.floor(crash * 100) / 100);
}

/** Convenience: seed + round number -> crash point. */
export function crashPoint(serverSeed, roundNumber, config = DEFAULT_CONFIG) {
  return crashPointFromHash(hashRound(serverSeed, roundNumber), config);
}

/**
 * Independent verification a player can run after the reveal.
 * Returns { ok, hash, crashPoint } — ok is true iff the revealed seed reproduces
 * both the committed hash and the reported crash point.
 */
export function verify(serverSeed, roundNumber, committedHash, reportedCrash, config = DEFAULT_CONFIG) {
  const hash = hashRound(serverSeed, roundNumber);
  const derived = crashPointFromHash(hash, config);
  return {
    ok: hash === committedHash && derived === reportedCrash,
    hash,
    crashPoint: derived,
  };
}
