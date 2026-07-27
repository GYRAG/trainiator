// Trainiator — SQLite persistence (fake wallets, round history, bets).
// Uses Node's built-in node:sqlite (zero deps). Synchronous API + single game
// process => no locking/concurrency to worry about.
//
// ponytail: balances stored as REAL and round2()'d on every write. Fine for a
// demo; switch to integer cents if float drift ever bites.

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const round2 = (n) => Math.round(n * 100) / 100;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS players (
  id         TEXT PRIMARY KEY,
  balance    REAL NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS rounds (
  round_id    INTEGER PRIMARY KEY,
  commit_hash TEXT NOT NULL,
  server_seed TEXT,          -- revealed at crash
  crash_point REAL,          -- revealed at crash
  created_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS bets (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  round_id           INTEGER NOT NULL,
  player_id          TEXT NOT NULL,
  stake              REAL NOT NULL,
  auto_cashout       REAL,   -- null = manual only
  cashout_multiplier REAL,   -- null until settled as a win
  payout             REAL NOT NULL DEFAULT 0,
  won                INTEGER NOT NULL DEFAULT 0,
  free               INTEGER NOT NULL DEFAULT 0,   -- 1 = stake covered by a free-bet token
  created_at         INTEGER NOT NULL
);
-- Retention bookkeeping (Part 2). Cosmetic/pacing only; never feeds RNG or RTP.
CREATE TABLE IF NOT EXISTS sessions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id    TEXT NOT NULL,
  started_at   INTEGER NOT NULL,
  last_seen    INTEGER NOT NULL,
  bet_count    INTEGER NOT NULL DEFAULT 0,
  win_count    INTEGER NOT NULL DEFAULT 0,
  loss_count   INTEGER NOT NULL DEFAULT 0,
  streak_type  TEXT,                          -- 'win' | 'loss' | null
  streak_count INTEGER NOT NULL DEFAULT 0,
  free_bets    INTEGER NOT NULL DEFAULT 0
);
`;

export function createDb(path = 'data/trainiator.sqlite') {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);

  // Lightweight migration for DBs created before a column existed. New tables are
  // handled by CREATE TABLE IF NOT EXISTS above; only added columns need this.
  // ponytail: hand-rolled column check, fine at this scale; use a migration tool
  // if the schema ever grows real complexity.
  const betCols = db.prepare('PRAGMA table_info(bets)').all().map((c) => c.name);
  if (!betCols.includes('free')) db.exec('ALTER TABLE bets ADD COLUMN free INTEGER NOT NULL DEFAULT 0');
  const playerCols = db.prepare('PRAGMA table_info(players)').all().map((c) => c.name);
  if (!playerCols.includes('name')) db.exec("ALTER TABLE players ADD COLUMN name TEXT NOT NULL DEFAULT ''");
  if (!playerCols.includes('last_topup')) db.exec('ALTER TABLE players ADD COLUMN last_topup INTEGER NOT NULL DEFAULT 0');

  const q = {
    insertPlayer: db.prepare('INSERT OR IGNORE INTO players (id, balance, created_at) VALUES (?, ?, ?)'),
    getPlayer: db.prepare('SELECT balance FROM players WHERE id = ?'),
    setName: db.prepare('UPDATE players SET name = ? WHERE id = ?'),
    getPlayerFull: db.prepare('SELECT balance, last_topup FROM players WHERE id = ?'),
    setTopup: db.prepare('UPDATE players SET last_topup = ? WHERE id = ?'),
    leaderboard: db.prepare("SELECT b.payout AS payout, b.cashout_multiplier AS mult, COALESCE(NULLIF(p.name, ''), 'anon') AS name FROM bets b JOIN players p ON p.id = b.player_id WHERE b.won = 1 AND b.created_at >= ? ORDER BY b.payout DESC LIMIT ?"),
    addBalance: db.prepare('UPDATE players SET balance = round(balance + ?, 2) WHERE id = ?'),
    insertRound: db.prepare('INSERT OR IGNORE INTO rounds (round_id, commit_hash, created_at) VALUES (?, ?, ?)'),
    revealRound: db.prepare('UPDATE rounds SET server_seed = ?, crash_point = ? WHERE round_id = ?'),
    insertBet: db.prepare(
      'INSERT INTO bets (round_id, player_id, stake, auto_cashout, free, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ),
    settleBet: db.prepare('UPDATE bets SET cashout_multiplier = ?, payout = ?, won = ? WHERE id = ?'),
    // --- sessions / retention ---
    latestSession: db.prepare('SELECT * FROM sessions WHERE id = (SELECT MAX(id) FROM sessions WHERE player_id = ?)'),
    insertSession: db.prepare('INSERT INTO sessions (player_id, started_at, last_seen) VALUES (?, ?, ?)'),
    touchSession: db.prepare('UPDATE sessions SET last_seen = ? WHERE id = ?'),
    bumpBet: db.prepare('UPDATE sessions SET bet_count = bet_count + 1, last_seen = ? WHERE id = ?'),
    updateStreak: db.prepare(
      'UPDATE sessions SET streak_type = ?, streak_count = ?, win_count = win_count + ?, loss_count = loss_count + ?, last_seen = ? WHERE id = ?',
    ),
    grantFree: db.prepare('UPDATE sessions SET free_bets = free_bets + 1 WHERE id = ?'),
    useFree: db.prepare('UPDATE sessions SET free_bets = free_bets - 1 WHERE id = ? AND free_bets > 0'),
  };

  return {
    /** Create the player with a starting balance if they don't exist; set name; return balance. */
    ensurePlayer(id, startingBalance, name) {
      q.insertPlayer.run(id, round2(startingBalance), Date.now());
      if (name) q.setName.run(String(name).slice(0, 20), id);
      return this.getBalance(id);
    },
    getBalance(id) {
      return q.getPlayer.get(id)?.balance ?? 0;
    },
    /** Faucet: top up if the balance is below `minBalance` and the cooldown has passed. */
    topUp(id, { amount, minBalance, cooldownMs }) {
      const p = q.getPlayerFull.get(id);
      if (!p) return { ok: false, error: 'no player' };
      if (p.balance >= minBalance) return { ok: false, error: `top-up only under ${minBalance}` };
      const waitMs = cooldownMs - (Date.now() - (p.last_topup || 0));
      if (waitMs > 0) return { ok: false, error: 'faucet cooling down', waitMs };
      q.setTopup.run(Date.now(), id);
      return { ok: true, balance: this.adjustBalance(id, amount) };
    },
    /** Top single-bet wins since local midnight, with player names. */
    leaderboard(limit = 10) {
      const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
      return q.leaderboard.all(midnight.getTime(), limit).map((r) => ({ name: r.name, payout: r.payout, mult: r.mult }));
    },
    /** Apply a signed delta (debit on bet, credit on cash-out); return new balance. */
    adjustBalance(id, delta) {
      q.addBalance.run(round2(delta), id);
      return this.getBalance(id);
    },
    recordRound(roundId, commitHash) {
      q.insertRound.run(roundId, commitHash, Date.now());
    },
    revealRound(roundId, serverSeed, crashPoint) {
      q.revealRound.run(serverSeed, crashPoint, roundId);
    },
    recordBet({ roundId, playerId, stake, autoCashout, free = false }) {
      const info = q.insertBet.run(roundId, playerId, round2(stake), autoCashout ?? null, free ? 1 : 0, Date.now());
      return Number(info.lastInsertRowid);
    },
    settleBet(betId, cashoutMultiplier, payout, won) {
      q.settleBet.run(cashoutMultiplier ?? null, round2(payout), won ? 1 : 0, betId);
    },

    // --- sessions / retention (cosmetic + pacing only) ---------------------
    getSession(playerId) {
      return q.latestSession.get(playerId) ?? null;
    },
    /** Resume the player's session if seen within gapMs, else open a new one. */
    startSession(playerId, gapMs) {
      const s = this.getSession(playerId);
      if (s && Date.now() - s.last_seen <= gapMs) {
        q.touchSession.run(Date.now(), s.id);
        return s.id;
      }
      return Number(q.insertSession.run(playerId, Date.now(), Date.now()).lastInsertRowid);
    },
    bumpBetCount(playerId) {
      const s = this.getSession(playerId);
      if (s) q.bumpBet.run(Date.now(), s.id);
    },
    /** Record a settled outcome; returns the new streak. */
    recordStreak(playerId, won) {
      const s = this.getSession(playerId);
      const type = won ? 'win' : 'loss';
      const count = s && s.streak_type === type ? s.streak_count + 1 : 1;
      if (s) q.updateStreak.run(type, count, won ? 1 : 0, won ? 0 : 1, Date.now(), s.id);
      return { streakType: type, streakCount: count };
    },
    getFreeBets(playerId) {
      return this.getSession(playerId)?.free_bets ?? 0;
    },
    grantFreeBet(playerId) {
      const s = this.getSession(playerId);
      if (s) q.grantFree.run(s.id);
    },
    /** Consume one free-bet token; returns true if one was available. */
    useFreeBet(playerId) {
      const s = this.getSession(playerId);
      return !!s && q.useFree.run(s.id).changes > 0;
    },
    /** Internal analytics: session length, bets/session, cash-out distribution. */
    dashboard() {
      const agg = db
        .prepare('SELECT COUNT(*) n, AVG(bet_count) avgBets, AVG(last_seen - started_at) avgLenMs FROM sessions WHERE bet_count > 0')
        .get();
      const buckets = [
        ['<1.2x', 1, 1.2],
        ['1.2–1.5x', 1.2, 1.5],
        ['1.5–2x', 1.5, 2],
        ['2–3x', 2, 3],
        ['3–5x', 3, 5],
        ['5x+', 5, Infinity],
      ];
      const cashoutDistribution = buckets.map(([label, lo, hi]) => ({
        label,
        count: db.prepare('SELECT COUNT(*) c FROM bets WHERE won = 1 AND cashout_multiplier >= ? AND cashout_multiplier < ?').get(lo, hi).c,
      }));
      return {
        sessions: agg.n,
        avgBetsPerSession: Math.round((agg.avgBets ?? 0) * 100) / 100,
        avgSessionSeconds: Math.round((agg.avgLenMs ?? 0) / 1000),
        cashoutDistribution,
      };
    },
    close() {
      db.close();
    },
  };
}
