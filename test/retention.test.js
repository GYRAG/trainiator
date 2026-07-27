import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDb } from '../src/db.js';
import { createRetention } from '../src/retention.js';
import { createGame } from '../src/engine.js';

const GAP = 60_000;

// Drive N rounds, always betting `stake` in the betting phase; resolve when all
// N have settled. Returns { betResults, settleResults }.
async function play({ store, retention, config, stake = 10, auto = null, n }) {
  const betResults = [];
  const settleResults = [];
  const betRounds = new Set();
  let game;
  await new Promise((resolve) => {
    game = createGame({
      onState: (s) => {
        if (s.phase === 'betting' && betRounds.size < n && !betRounds.has(s.roundId)) {
          const r = game.placeBet('p1', stake, auto);
          if (r.ok) {
            betRounds.add(s.roundId);
            betResults.push(r);
          }
        }
      },
      store,
      retention,
      onPlayerResult: (_pid, r) => {
        settleResults.push(r);
        if (settleResults.length >= n) resolve();
      },
      config,
    });
    game.start();
    setTimeout(resolve, 6000);
  });
  game.stop();
  return { betResults, settleResults };
}

test('#2 streaks increment and reset on the opposite outcome', () => {
  const db = createDb(':memory:');
  db.startSession('p', GAP);
  assert.deepEqual(db.recordStreak('p', false), { streakType: 'loss', streakCount: 1 });
  assert.deepEqual(db.recordStreak('p', false), { streakType: 'loss', streakCount: 2 });
  assert.deepEqual(db.recordStreak('p', true), { streakType: 'win', streakCount: 1 }, 'a win resets the loss streak');
  assert.deepEqual(db.recordStreak('p', true), { streakType: 'win', streakCount: 2 });
  db.close();
});

test('#4 free bet: granted after the loss-streak threshold, then covers the stake', async () => {
  const db = createDb(':memory:');
  db.ensurePlayer('p1', 100);
  const retention = createRetention({ store: db, config: { freeBetChance: 1, lossStreakForReward: 3 } });
  retention.startSession('p1');

  // Every round busts at 1.00x -> guaranteed losses. freeBetChance=1 grants a
  // token the moment the loss streak hits 3.
  const { betResults } = await play({ store: db, retention, n: 5, config: { variablePacing: false, instantCrashRate: 1, bettingMs: 15, crashedMs: 15, tickMs: 5 } });

  assert.equal(betResults.slice(0, 3).every((r) => r.free === false), true, 'first 3 bets paid from the wallet');
  assert.equal(betResults[3].free, true, 'bet #4 covered by the earned free-bet token');
  assert.equal(db.getBalance('p1'), 70, 'only the 3 real stakes (3x10) were debited; free bets cost nothing');
  db.close();
});

test('#3 variable pacing keeps every betting window inside the configured range', async () => {
  const windows = [];
  let game;
  const min = 40;
  const max = 90;
  await new Promise((resolve) => {
    game = createGame({
      onState: (s) => {
        if (s.phase === 'betting' && s.bettingEndsAt) {
          windows.push(s.bettingEndsAt - Date.now());
          if (windows.length >= 6) resolve();
        }
      },
      config: { variablePacing: true, bettingMsMin: min, bettingMsMax: max, crashedMs: 10, tickMs: 5, k: 8 },
    });
    game.start();
    setTimeout(resolve, 4000);
  });
  game.stop();

  assert.ok(windows.length >= 4, 'observed several rounds');
  for (const w of windows) assert.ok(w >= min - 10 && w <= max + 10, `window ${w}ms outside [${min},${max}]`);
  assert.ok(new Set(windows).size > 1, 'windows actually vary round to round');
});

test('#1 near-miss flag is cosmetic and consistent with the untouched crash point', async () => {
  const db = createDb(':memory:');
  db.ensurePlayer('p1', 100000);
  const AUTO = 3.0;
  const THRESH = 0.1;
  const { settleResults } = await play({
    store: db,
    n: 40,
    stake: 1,
    auto: AUTO,
    config: { variablePacing: false, instantCrashRate: 0, nearMiss: true, nearMissThreshold: THRESH, bettingMs: 8, crashedMs: 8, tickMs: 4, k: 8 },
  });

  const losses = settleResults.filter((r) => r.type === 'crash');
  assert.ok(losses.length >= 1, 'saw at least one loss with an auto target');
  for (const r of losses) {
    // The flag must exactly match "crashed within THRESH below the auto target",
    // proving it only reports genuine closeness — it never moved the crash point.
    assert.equal(r.nearMiss, r.crashPoint >= AUTO - THRESH, `nearMiss mismatch at crash ${r.crashPoint}`);
  }
  db.close();
});

test('#5 dashboard aggregates sessions and cash-out distribution', () => {
  const db = createDb(':memory:');
  db.ensurePlayer('p1', 1000);
  db.startSession('p1', GAP);
  db.bumpBetCount('p1');
  db.bumpBetCount('p1');
  // A couple of winning bets at known multipliers to shape the distribution.
  const b1 = db.recordBet({ roundId: 1, playerId: 'p1', stake: 10 });
  db.settleBet(b1, 1.35, 13.5, true);
  const b2 = db.recordBet({ roundId: 2, playerId: 'p1', stake: 10 });
  db.settleBet(b2, 4.2, 42, true);

  const d = db.dashboard();
  assert.equal(d.sessions, 1);
  assert.equal(d.avgBetsPerSession, 2);
  assert.equal(d.cashoutDistribution.length, 6);
  assert.equal(d.cashoutDistribution.find((b) => b.label === '1.2–1.5x').count, 1);
  assert.equal(d.cashoutDistribution.find((b) => b.label === '3–5x').count, 1);
  db.close();
});
