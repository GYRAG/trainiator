// Procedural sound via Web Audio — no asset files. Engine chug (rate scales with
// the multiplier), a departure whistle, a cash-out ding, and a derail crash.
// Starts muted-until-gesture (browsers block autoplay); toggle with setMuted.

let ctx = null;
let master = null;
let muted = false;
let volume = 0.5;
let chug = null; // { osc, lfo, lfoGain, gain }

function ensure() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : volume;
  master.connect(ctx.destination);
  return ctx;
}

export function setVolume(v) {
  volume = Math.max(0, Math.min(1, v));
  if (master && !muted) master.gain.setTargetAtTime(volume, ctx.currentTime, 0.05);
  if (cashEl) cashEl.volume = Math.min(1, volume * 1.4);
}

// Call from a user gesture (e.g. first bet) so audio is allowed to play.
export function unlock() { const c = ensure(); if (c && c.state === 'suspended') c.resume(); }

export function setMuted(m) {
  muted = m;
  if (master) master.gain.setTargetAtTime(muted ? 0 : volume, ctx.currentTime, 0.02);
}
export function isMuted() { return muted; }

function blip({ type = 'sine', from, to, dur, gain = 0.3, delay = 0 }) {
  const c = ensure(); if (!c) return;
  const t = c.currentTime + delay;
  const o = c.createOscillator(); const g = c.createGain();
  o.type = type; o.frequency.setValueAtTime(from, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.02);
}

// Gentle triangle whistle (the sawtooth version was harsh).
export function whistle() { blip({ type: 'triangle', from: 500, to: 660, dur: 0.5, gain: 0.1 }); blip({ type: 'triangle', from: 640, to: 740, dur: 0.55, gain: 0.07, delay: 0.05 }); }

// Cash-out uses the user's MP3 (an HTMLAudioElement, independent of the synths).
let cashEl = null;
export function cashDing() {
  if (muted) return;
  if (!cashEl) { cashEl = new Audio('/sounds/cashout.mp3'); cashEl.preload = 'auto'; cashEl.volume = 0.7; }
  try { cashEl.currentTime = 0; cashEl.play(); } catch { /* ignore */ }
}
export function derail() {
  const c = ensure(); if (!c) return;
  blip({ type: 'sawtooth', from: 220, to: 40, dur: 0.7, gain: 0.3 });
  const t = c.currentTime; // noise burst
  const buf = c.createBuffer(1, c.sampleRate * 0.5, c.sampleRate);
  const d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const src = c.createBufferSource(); src.buffer = buf; const g = c.createGain(); g.gain.value = 0.25;
  src.connect(g); g.connect(master); src.start(t);
}

// Continuous engine chug: soft low triangle with a gentle sine tremolo (the
// sawtooth+square version was buzzy/harsh). Kept quiet so it never grates.
export function startChug() {
  const c = ensure(); if (!c || chug) return;
  const osc = c.createOscillator(); osc.type = 'triangle'; osc.frequency.value = 66;
  const gain = c.createGain(); gain.gain.value = 0.0;
  const lfo = c.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 2.2;
  const lfoGain = c.createGain(); lfoGain.gain.value = 0.035;
  lfo.connect(lfoGain); lfoGain.connect(gain.gain);
  osc.connect(gain); gain.connect(master); osc.start(); lfo.start();
  chug = { osc, lfo, gain };
  chug.gain.gain.setTargetAtTime(0.04, c.currentTime, 0.2);
}
export function setChugRate(mult) { if (chug && ctx) chug.lfo.frequency.setTargetAtTime(2 + Math.min(mult, 20) * 0.32, ctx.currentTime, 0.2); }
export function stopChug() {
  if (!chug || !ctx) return;
  chug.gain.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.05);
  const c = chug; setTimeout(() => { try { c.osc.stop(); c.lfo.stop(); } catch { /* already stopped */ } }, 200);
  chug = null;
}
