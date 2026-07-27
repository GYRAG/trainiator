// Trainiator — multiplier growth curve.
//
// Separate from crash-point generation (src/rng.js): the RNG decides WHERE the
// train derails, this decides HOW FAST the multiplier climbs to get there.
//
//   multiplier(t) = e^(k * t)   t = seconds since round start, starts at 1.00x
//
// The live climbing value is broadcast every 100ms (Step 3) purely for the
// animation. The crash itself fires at the exact, pre-committed crashPoint —
// at time timeToCrash(crashPoint) — so the shown crash value is always the
// provably-fair number, never a sampled overshoot.

// k = growth rate. Bigger = faster climb. Tune by feel.
// At k=0.06: 2x ~11.6s, 5x ~26.8s, 10x ~38.4s.
export const GROWTH_CONFIG = { k: 0.06 };

/** Live multiplier at elapsed time t (seconds). */
export function multiplierAt(t, k = GROWTH_CONFIG.k) {
  return Math.exp(k * t);
}

/**
 * Elapsed time (seconds) at which the multiplier reaches `target`.
 * Inverse of multiplierAt. Round duration = timeToCrash(crashPoint).
 * A 1.00x instant crash returns 0 (round ends immediately).
 */
export function timeToCrash(target, k = GROWTH_CONFIG.k) {
  return Math.log(target) / k;
}
