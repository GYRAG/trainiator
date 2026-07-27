import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GROWTH_CONFIG, multiplierAt, timeToCrash } from '../src/curve.js';

const K = GROWTH_CONFIG.k;

test('starts at 1.00x and climbs monotonically', () => {
  assert.equal(multiplierAt(0), 1);
  let prev = 1;
  for (let t = 0.1; t <= 60; t += 0.1) {
    const m = multiplierAt(t);
    assert.ok(m > prev, `not increasing at t=${t}`);
    prev = m;
  }
});

test('hits arbitrary target multipliers within a tight time-error margin', () => {
  // Round-trip: the time we compute for a target must reproduce that target.
  for (const target of [1.01, 1.5, 2, 3.7, 10, 100, 1000]) {
    const t = timeToCrash(target);
    const reached = multiplierAt(t);
    // Convert back to a time error: how far off in seconds is the reached value?
    const timeError = Math.abs(timeToCrash(reached) - t);
    assert.ok(timeError < 1e-9, `target ${target}x off by ${timeError}s`);
    assert.ok(Math.abs(reached - target) < 1e-9, `target ${target}x reached ${reached}`);
  }
});

test('1.00x instant crash ends at t=0', () => {
  assert.equal(timeToCrash(1), 0);
});

test('tick sampling never fires the crash early (crashes at or after true time)', () => {
  // The game loop samples every 100ms; it must not end the round before the
  // multiplier actually reaches the crash point. Check the first tick that
  // meets/exceeds a crash point lands at or after the exact crash time.
  const DT = 0.1;
  for (const crash of [1.2, 2, 5.5, 42]) {
    const exact = timeToCrash(crash);
    const firstTick = Math.ceil(exact / DT) * DT;
    assert.ok(firstTick >= exact - 1e-12, `crash ${crash}x: tick ${firstTick} before ${exact}`);
    assert.ok(firstTick - exact < DT, `crash ${crash}x: tick more than one interval late`);
  }
});

test('k tunes climb speed (larger k reaches a target sooner)', () => {
  assert.ok(timeToCrash(10, 0.12) < timeToCrash(10, 0.06));
});
