import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../src/engine.js';
import { verify } from '../src/rng.js';

// Run one fast round end-to-end and assert the phase cycle + the fairness rule:
// crashPoint/serverSeed stay hidden until the crash, then verify correctly.
// Resolves on the first `crashed` state (not a wall-clock guess) so it's not flaky.
test('round cycles betting -> running -> crashed; secrets hidden then verifiable', async () => {
  const states = [];
  let game;
  await new Promise((resolve) => {
    game = createGame({
      onState: (s) => {
        states.push(s);
        if (s.phase === 'crashed') resolve();
      },
      config: { variablePacing: false, bettingMs: 20, crashedMs: 40, tickMs: 10, k: 5 },
    });
    game.start();
    setTimeout(resolve, 5000); // safety net so a bug can't hang the suite
  });
  game.stop();

  const phases = states.map((s) => s.phase);
  assert.ok(phases.includes('betting'), 'saw betting');
  assert.ok(phases.includes('crashed'), 'saw crashed');

  // No pre-crash state may leak the crash point or the seed.
  for (const s of states) {
    if (s.phase !== 'crashed') {
      assert.equal(s.crashPoint, undefined, `crashPoint leaked in ${s.phase}`);
      assert.equal(s.serverSeed, undefined, `serverSeed leaked in ${s.phase}`);
    }
  }

  // The revealed crash state must be independently verifiable.
  const crashed = states.find((s) => s.phase === 'crashed');
  assert.ok(crashed.serverSeed && crashed.crashPoint, 'crash reveals seed + point');
  const v = verify(crashed.serverSeed, crashed.roundId, crashed.commitHash, crashed.crashPoint);
  assert.equal(v.ok, true, 'revealed seed reproduces hash + crash point');

  // History records the crash.
  assert.equal(crashed.history.at(-1).crashPoint, crashed.crashPoint);
});
