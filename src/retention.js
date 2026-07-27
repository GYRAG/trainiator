// Trainiator — retention mechanics (Part 2).
//
// EVERY mechanic here is cosmetic or pacing. NONE of it touches the crash-point
// RNG or the RTP — those live in rng.js and are provably fair. This module only
// reacts to outcomes the RNG already decided.
//
//   #1 near-miss   -> handled in engine.js: a COSMETIC flag on genuinely-close
//                     crashes. No seed grinding, no biasing (that's impossible to
//                     do without breaking provable fairness — see engine notes).
//   #2 streaks     -> consecutive win/loss counts per session, for UI badges.
//   #4 free bet    -> a small rebate token after a losing streak. A bonus, not a
//                     rigged outcome; it never changes what the wheel lands on.
//   (#3 variable pacing lives in engine.js; #5 dashboard is db.dashboard().)

export const DEFAULT_RETENTION_CONFIG = {
  streaks: true, // #2 expose streak badges
  freeBetChance: 0.03, // #4 chance to drop a free-bet token on a qualifying loss
  lossStreakForReward: 3, // #4 only after this many losses in a row
  sessionGapMs: 30 * 60 * 1000, // reconnect within 30 min resumes the same session
};

export function createRetention({ store, config = {} }) {
  const cfg = { ...DEFAULT_RETENTION_CONFIG, ...config };

  const publicStats = (playerId) => {
    const s = store.getSession(playerId);
    return {
      streak: cfg.streaks && s?.streak_count ? { type: s.streak_type, count: s.streak_count } : null,
      freeBets: s?.free_bets ?? 0,
    };
  };

  return {
    config: cfg,

    startSession(playerId) {
      store.startSession(playerId, cfg.sessionGapMs);
      return publicStats(playerId);
    },

    onBet(playerId) {
      store.bumpBetCount(playerId);
    },

    // Called once per settled bet. Returns the retention fields to merge into the
    // player's result: streak badge + any reward earned.
    onOutcome(playerId, won) {
      const streak = store.recordStreak(playerId, won);
      let reward = null;
      if (
        !won &&
        cfg.freeBetChance > 0 &&
        streak.streakType === 'loss' &&
        streak.streakCount >= cfg.lossStreakForReward &&
        Math.random() < cfg.freeBetChance
      ) {
        store.grantFreeBet(playerId);
        reward = 'freeBet';
      }
      return {
        streak: cfg.streaks ? streak : null,
        freeBets: store.getFreeBets(playerId),
        reward,
      };
    },

    stats: publicStats,
  };
}
