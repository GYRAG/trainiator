import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { createDb } from '../src/db.js';
import { createGame } from '../src/engine.js';

const round2 = (n) => Math.round(n * 100) / 100;

test('wallet math is correct and persists across reopen', () => {
  const path = join(tmpdir(), `trn-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`);
  let db = createDb(path);
  assert.equal(db.ensurePlayer('p', 500), 500);
  assert.equal(db.ensurePlayer('p', 999), 500, 'ensurePlayer must not reset an existing balance');
  assert.equal(db.adjustBalance('p', -120.5), 379.5); // debit a bet
  assert.equal(db.adjustBalance('p', 40.25), 419.75); // credit a cash-out
  db.close();

  db = createDb(path); // reopen the same file
  assert.equal(db.getBalance('p'), 419.75, 'balance survived a restart');
  db.close();
  rmSync(path, { force: true });
});

// Bet on the first N rounds, then resolve once all N have settled — no
// wall-clock guess, so stop() never races an in-flight round.
async function playRounds({ store, config, onSettle, n }) {
  const betRounds = new Set();
  let game;
  await new Promise((resolve) => {
    game = createGame({
      onState: (s) => {
        if (s.phase === 'betting' && betRounds.size < n && !betRounds.has(s.roundId)) {
          if (onSettle.bet(game, s)) betRounds.add(s.roundId);
        }
      },
      store,
      onPlayerResult: (_pid, r) => {
        onSettle.result(r);
        if (onSettle.settled >= n) resolve();
      },
      config,
    });
    game.start();
    setTimeout(resolve, 6000); // safety net
  });
  game.stop();
  return betRounds.size;
}

test('crash loss: player who stays in loses exactly the stake', async () => {
  const db = createDb(':memory:');
  db.ensurePlayer('p1', 100);
  const N = 5;
  const results = [];
  const tracker = { settled: 0, bet: (g) => g.placeBet('p1', 10).ok, result: (r) => (results.push(r), (tracker.settled += 1)) };

  const placed = await playRounds({ store: db, n: N, onSettle: tracker, config: { variablePacing: false, instantCrashRate: 1, bettingMs: 15, crashedMs: 15, tickMs: 5 } });

  assert.equal(placed, N, 'placed exactly N bets');
  assert.equal(results.length, N, 'all N bets settled');
  assert.ok(results.every((r) => r.type === 'crash' && r.lost === 10), 'all losses of exactly the stake');
  assert.equal(db.getBalance('p1'), round2(100 - 10 * N), 'balance debited once per losing bet');
});

test('auto cash-out win: payout = stake x target, balance reconciles', async () => {
  const db = createDb(':memory:');
  db.ensurePlayer('p1', 1000);
  const N = 8;
  let expected = 1000;
  let wins = 0;
  const tracker = {
    settled: 0,
    bet: (g) => {
      const r = g.placeBet('p1', 10, 1.01); // auto cash-out at 1.01x
      if (r.ok) expected -= 10;
      return r.ok;
    },
    result: (r) => {
      tracker.settled += 1;
      if (r.type === 'cashout') {
        wins += 1;
        assert.equal(r.multiplier, 1.01, 'cashed out at the auto target');
        assert.equal(r.payout, round2(10 * 1.01), 'payout = stake x target');
        expected += r.payout;
      }
    },
  };

  const placed = await playRounds({ store: db, n: N, onSettle: tracker, config: { variablePacing: false, instantCrashRate: 0, bettingMs: 15, crashedMs: 15, tickMs: 5, k: 5 } });

  assert.equal(placed, N, 'placed exactly N bets');
  assert.ok(wins >= 1, 'won at least one round via auto cash-out');
  assert.equal(db.getBalance('p1'), round2(expected), 'balance matches stake debits + win credits');
});

test('bet validation: closed window, no double-bet, min stake, insufficient funds', () => {
  const db = createDb(':memory:');
  db.ensurePlayer('p1', 5);
  const game = createGame({ onState: () => {}, store: db, config: { bettingMs: 100000 } });

  // No round yet -> betting closed.
  assert.equal(game.placeBet('p1', 1).ok, false);

  game.start(); // enters betting (long window)
  assert.equal(game.placeBet('p1', 100).ok, false, 'stake above balance rejected');
  assert.equal(game.placeBet('p1', 0.5).ok, false, 'below min bet rejected');
  assert.equal(game.placeBet('p1', 2, 0.9).ok, false, 'auto target <= 1 rejected');
  assert.equal(game.placeBet('p1', 2).ok, true, 'valid bet accepted');
  assert.equal(game.placeBet('p1', 2).ok, false, 'second bet same round rejected');
  assert.equal(db.getBalance('p1'), 3, 'only the one valid stake was debited');
  game.stop();
});
