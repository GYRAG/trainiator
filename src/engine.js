// Trainiator — authoritative round loop.
//
// Ties the provably-fair RNG (rng.js) to the growth curve (curve.js) and drives
// the betting -> running -> crashed cycle. The SERVER owns the clock; timers here
// are the game's source of truth. (Client-side animation binds GSAP to the
// broadcast multiplier — that's a separate concern.)
//
// Fairness rule enforced here: crashPoint and serverSeed are SECRET during
// betting/running and only revealed in the `crashed` state. Only `commitHash`
// (the SHA-256 commitment) is public up front, so nobody can see the crash coming.

import { generateServerSeed, hashRound, crashPointFromHash, DEFAULT_CONFIG } from './rng.js';
import { multiplierAt, timeToCrash, GROWTH_CONFIG } from './curve.js';

export const DEFAULT_GAME_CONFIG = {
  rtp: DEFAULT_CONFIG.rtp,
  instantCrashRate: DEFAULT_CONFIG.instantCrashRate,
  k: GROWTH_CONFIG.k,
  bettingMs: 5000, // used when variablePacing is off
  crashedMs: 3000, // pause on the crash screen before the next round
  tickMs: 100, // multiplier broadcast interval
  historyLen: 20, // last N crash points kept for the history bar
  startingBalance: 1000, // fake currency handed to each new player
  minBet: 1,
  maxBet: 10000, // cap so nobody can wager an absurd amount
  // --- retention / pacing (Part 2). Toggleable; none of these touch the RNG. ---
  variablePacing: true, // #3 randomize the betting window round to round
  bettingMsMin: 4000, // #3 window range
  bettingMsMax: 7000,
  nearMiss: true, // #1 flag genuinely-close crashes (COSMETIC — no seed grinding)
  nearMissThreshold: 0.1, // "so close" if the crash lands within this of an auto target
};

const round2 = (n) => Math.round(n * 100) / 100;
const randInt = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));

// createGame({ onState, config, store, onPlayerResult, retention })
//   store          - SQLite-backed wallet/bet persistence (src/db.js). Optional:
//                    without it the round loop still runs, betting is just no-op'd.
//   onPlayerResult - called for outcomes the player didn't directly request
//                    (auto-cash-outs firing, crash losses) so the server can push
//                    them to that player's socket.
//   retention      - optional retention layer (src/retention.js). Cosmetic only.
//   onRiders       - called with the public riders list whenever bets/cash-outs
//                    change, so the server can broadcast the live field to all.
export function createGame({ onState, config = {}, store = null, onPlayerResult = null, retention = null, onRiders = null }) {
  const cfg = { ...DEFAULT_GAME_CONFIG, ...config };

  let roundId = 0;
  let round = null; // full secret state for the current round
  const history = []; // [{ roundId, crashPoint }], newest last
  const bets = new Map(); // playerId -> { betId, stake, auto, cashedOut } for THIS round
  let tickTimer = null;
  let phaseTimer = null;

  // Only the fields safe to broadcast for the current phase.
  function publicState() {
    if (!round) return { phase: 'idle', history };
    const s = {
      phase: round.phase,
      roundId: round.roundId,
      commitHash: round.commitHash,
      multiplier: round2(round.multiplier),
      history,
    };
    if (round.phase === 'betting') s.bettingEndsAt = round.bettingEndsAt;
    if (round.phase === 'crashed') {
      // Reveal: players can now re-hash the seed and re-derive the crash point.
      s.crashPoint = round.crashPoint;
      s.serverSeed = round.serverSeed;
    }
    return s;
  }

  const emit = () => onState(publicState());

  // Public (anonymized) snapshot of everyone in the current round.
  const roundRiders = () =>
    [...bets.values()].map((b) => ({ id: b.playerId, name: b.name, stake: b.stake, cashedAt: b.cashedAt, payout: b.cashedAt ? round2(b.stake * b.cashedAt) : 0, lost: b.lost }));
  const emitRiders = () => onRiders?.(roundRiders());

  // --- betting / wallet ---------------------------------------------------

  // Merge cosmetic retention fields (streak badge, reward) into a settled result.
  const withRetention = (playerId, result) =>
    retention ? { ...result, ...retention.onOutcome(playerId, result.type === 'cashout') } : result;

  // Settle a bet as a WIN at `atMultiplier` (manual cash-out, or an auto target).
  function settleWin(playerId, bet, atMultiplier) {
    const m = round2(atMultiplier);
    const payout = round2(bet.stake * m);
    bet.cashedOut = true;
    bet.cashedAt = m;
    const balance = store ? store.adjustBalance(playerId, payout) : undefined;
    store?.settleBet(bet.betId, m, payout, true);
    return withRetention(playerId, { ok: true, type: 'cashout', roundId: round.roundId, multiplier: m, payout, balance, auto: bet.auto === m });
  }

  function placeBet(playerId, stake, autoCashout = null, name = '') {
    if (!round || round.phase !== 'betting') return { ok: false, error: 'betting is closed' };
    if (bets.has(playerId)) return { ok: false, error: 'already bet this round' };
    stake = round2(Number(stake));
    if (!(stake >= cfg.minBet)) return { ok: false, error: `minimum bet is ${cfg.minBet}` };
    if (stake > cfg.maxBet) return { ok: false, error: `maximum bet is ${cfg.maxBet}` };
    const auto = autoCashout == null || autoCashout === '' ? null : Number(autoCashout);
    if (auto != null && !(auto > 1)) return { ok: false, error: 'auto cash-out must be above 1.00x' };

    // A free-bet token (earned via retention #4) covers the stake — a rebate, not
    // a rigged outcome. Otherwise the stake is debited from the wallet as normal.
    const free = store?.useFreeBet ? store.useFreeBet(playerId) : false;
    if (!free && store && stake > store.getBalance(playerId)) return { ok: false, error: 'insufficient balance' };

    const betId = store ? store.recordBet({ roundId: round.roundId, playerId, stake, autoCashout: auto, free }) : 0;
    const balance = store ? (free ? store.getBalance(playerId) : store.adjustBalance(playerId, -stake)) : undefined;
    bets.set(playerId, { betId, stake, auto, cashedOut: false, cashedAt: null, lost: false, name, playerId });
    retention?.onBet(playerId);
    emitRiders(); // everyone sees the new rider
    return { ok: true, type: 'bet', roundId: round.roundId, stake, autoCashout: auto, balance, free };
  }

  // Manual cash-out at the live multiplier (or a forced target for auto-cash-out).
  function cashOut(playerId, at = null) {
    if (!round || round.phase !== 'running') return { ok: false, error: 'not running' };
    const bet = bets.get(playerId);
    if (!bet) return { ok: false, error: 'no active bet' };
    if (bet.cashedOut) return { ok: false, error: 'already cashed out' };
    const live = multiplierAt((Date.now() - round.startedAt) / 1000, cfg.k);
    const res = settleWin(playerId, bet, at ?? live);
    emitRiders();
    return res;
  }

  function startBetting() {
    roundId += 1;
    const serverSeed = generateServerSeed();
    const commitHash = hashRound(serverSeed, roundId);
    round = {
      phase: 'betting',
      roundId,
      serverSeed, // secret until crash
      commitHash, // public commitment
      crashPoint: crashPointFromHash(commitHash, cfg), // secret until crash
      multiplier: 1,
      startedAt: null,
      bettingEndsAt: null,
    };
    // #3 Variable pacing: jitter the betting window; fixed intervals dull engagement.
    const bettingMs = cfg.variablePacing ? randInt(cfg.bettingMsMin, cfg.bettingMsMax) : cfg.bettingMs;
    round.bettingEndsAt = Date.now() + bettingMs;
    bets.clear();
    store?.recordRound(roundId, commitHash);
    emit();
    phaseTimer = setTimeout(startRunning, bettingMs);
  }

  function startRunning() {
    round.phase = 'running';
    round.startedAt = Date.now();
    const crashMs = timeToCrash(round.crashPoint, cfg.k) * 1000;
    emit();

    // Instant crash (1.00x) => crashMs is 0, end immediately.
    tickTimer = setInterval(() => {
      try {
        const elapsed = (Date.now() - round.startedAt) / 1000;
        if (elapsed * 1000 >= crashMs) return crash();
        round.multiplier = multiplierAt(elapsed, cfg.k);
        // Fire any auto-cash-outs whose target the multiplier just crossed.
        let fired = false;
        for (const [pid, bet] of bets) {
          if (!bet.cashedOut && bet.auto != null && round.multiplier >= bet.auto) {
            onPlayerResult?.(pid, settleWin(pid, bet, bet.auto));
            fired = true;
          }
        }
        if (fired) emitRiders();
        emit();
      } catch (err) {
        console.error('tick error — forcing crash to recover the loop', err);
        crash();
      }
    }, cfg.tickMs);
    if (crashMs === 0) crash();
  }

  function crash() {
    if (!round || round.phase !== 'running') return; // idempotent: never settle a round twice
    clearInterval(tickTimer);
    tickTimer = null;
    round.phase = 'crashed';
    round.multiplier = round.crashPoint; // show the exact provably-fair value

    // A DB/callback error while settling must not freeze the loop: log it, then
    // always advance to the next round below (history + emit + phaseTimer).
    try {
      store?.revealRound(round.roundId, round.serverSeed, round.crashPoint);

      // Settle whoever is still in. Backstop: an auto target at/under the crash
      // point is a WIN even if the tick loop didn't fire it (timing safety), so
      // auto-cash-out outcomes are deterministic, not tick-alignment-dependent.
      for (const [pid, bet] of bets) {
        if (bet.cashedOut) continue;
        if (bet.auto != null && bet.auto <= round.crashPoint) {
          onPlayerResult?.(pid, settleWin(pid, bet, bet.auto));
        } else {
          bet.lost = true;
          store?.settleBet(bet.betId, null, 0, false);
          const balance = store ? store.getBalance(pid) : undefined;
          // #1 COSMETIC near-miss: did the train derail just shy of their auto target?
          // The crash point is untouched RNG; this only flags a genuinely close call.
          const nearMiss =
            cfg.nearMiss && bet.auto != null && round.crashPoint >= bet.auto - cfg.nearMissThreshold;
          onPlayerResult?.(
            pid,
            withRetention(pid, { ok: true, type: 'crash', roundId: round.roundId, crashPoint: round.crashPoint, lost: bet.stake, balance, nearMiss }),
          );
        }
      }
      emitRiders();
    } catch (err) {
      console.error('crash settlement error — advancing to next round anyway', err);
    }

    history.push({ roundId: round.roundId, crashPoint: round.crashPoint });
    if (history.length > cfg.historyLen) history.shift();
    emit();
    phaseTimer = setTimeout(startBetting, cfg.crashedMs); // always advance the loop
  }

  return {
    start: startBetting,
    getState: publicState,
    getRiders: roundRiders,
    placeBet,
    cashOut,
    get config() {
      return cfg;
    },
    stop() {
      clearInterval(tickTimer);
      clearTimeout(phaseTimer);
      tickTimer = phaseTimer = null;
    },
  };
}
