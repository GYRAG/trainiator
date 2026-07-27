// Client-side, cosmetic achievements. Purely OBSERVATIONAL — they react to
// outcomes the server already decided and never touch the game loop or the
// provably-fair RNG. Persisted per browser in localStorage.

const KEY = 'trainiator_achievements';
const BETS_KEY = 'trainiator_betcount';

export const ACHIEVEMENTS = [
  { id: 'first-ride',   icon: '🚉', title: 'First Ride',       desc: 'Place your first bet.' },
  { id: 'all-aboard',   icon: '✅', title: 'All Aboard',        desc: 'Cash out for the first time.' },
  { id: 'express',      icon: '💨', title: 'Express',           desc: 'Cash out at 5× or higher.' },
  { id: 'runaway',      icon: '🔥', title: 'Runaway Train',     desc: 'Cash out at 10× or higher.' },
  { id: 'full-steam',   icon: '🚂', title: 'Full Steam',        desc: 'Cash out at 25× or higher.' },
  { id: 'on-a-roll',    icon: '🎢', title: 'On a Roll',         desc: 'Win three rounds in a row.' },
  { id: 'so-close',     icon: '😬', title: 'So Close',          desc: 'Survive a near miss.' },
  { id: 'conductor',    icon: '🎩', title: 'Conductor',         desc: 'Place 25 bets.' },
  { id: 'trust-verify', icon: '🔎', title: 'Trust, but Verify', desc: "Verify a round's fairness." },
];

const titles = Object.fromEntries(ACHIEVEMENTS.map((a) => [a.id, a.title]));
export const title = (id) => titles[id] ?? id;

export function getUnlocked() {
  try { return new Set(JSON.parse(localStorage.getItem(KEY)) || []); } catch { return new Set(); }
}

/** Unlock an achievement; returns true only the FIRST time (so callers can toast). */
export function unlock(id) {
  const set = getUnlocked();
  if (set.has(id)) return false;
  set.add(id);
  try { localStorage.setItem(KEY, JSON.stringify([...set])); } catch { /* storage blocked */ }
  return true;
}

/** Lifetime bet counter (for the 'conductor' milestone); returns the new total. */
export function bumpBets() {
  const n = (Number(localStorage.getItem(BETS_KEY)) || 0) + 1;
  try { localStorage.setItem(BETS_KEY, String(n)); } catch { /* storage blocked */ }
  return n;
}
