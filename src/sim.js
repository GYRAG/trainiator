// Console-only stats for the crash-point generator. Run: npm run sim
import { DEFAULT_CONFIG, generateServerSeed, hashRound, crashPointFromHash } from './rng.js';

const ROUNDS = 200000;
const cfg = DEFAULT_CONFIG;

let instant = 0;
const buckets = { '1.00x (instant)': 0, '<2x': 0, '2x–5x': 0, '5x–10x': 0, '10x+': 0 };
const targetHits = { 1.5: 0, 2.0: 0, 3.0: 0, 10.0: 0 };

for (let n = 0; n < ROUNDS; n++) {
  const c = crashPointFromHash(hashRound(generateServerSeed(), n), cfg);
  if (c === 1.0) {
    instant++;
    buckets['1.00x (instant)']++;
  } else if (c < 2) buckets['<2x']++;
  else if (c < 5) buckets['2x–5x']++;
  else if (c < 10) buckets['5x–10x']++;
  else buckets['10x+']++;
  for (const t of Object.keys(targetHits)) if (c >= Number(t)) targetHits[t]++;
}

const theoreticalRtp = (m) => (m * cfg.rtp) / (cfg.rtp + m - 1);

console.log(`\nTrainiator crash-point generator — ${ROUNDS.toLocaleString()} simulated rounds`);
console.log(`config: rtp(profit) = ${cfg.rtp}, instantCrashRate = ${cfg.instantCrashRate}\n`);

console.log('Distribution:');
for (const [k, v] of Object.entries(buckets)) {
  console.log(`  ${k.padEnd(16)} ${((v / ROUNDS) * 100).toFixed(2).padStart(6)}%`);
}

console.log('\nRealized RTP by cash-out target (progressive edge — vs theoretical curve):');
for (const [t, hits] of Object.entries(targetHits)) {
  const realized = (Number(t) * hits) / ROUNDS;
  const edge = ((1 - realized) * 100).toFixed(1);
  console.log(
    `  @ ${String(t).padStart(5)}x -> RTP ${realized.toFixed(4)} (theory ${theoreticalRtp(Number(t)).toFixed(4)}, edge ${edge}%, win ${((hits / ROUNDS) * 100).toFixed(2)}%)`,
  );
}

console.log(`\nInstant-crash rate: ${((instant / ROUNDS) * 100).toFixed(2)}%  (target ~1%, decoupled from edge)`);
