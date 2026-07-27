import { memo, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, MotionConfig } from 'motion/react';
import { socket } from './socket.js';
import { TrainScene } from './TrainScene.jsx';
import { LiveBets } from './LiveBets.jsx';
import * as sound from './sound.js';

const short = (hex) => (hex ? `${hex.slice(0, 12)}…${hex.slice(-8)}` : '—');
const money = (n) => (typeof n === 'number' ? n.toFixed(2) : '—');
const pillClass = (v) => (v >= 10 ? 'gold' : v >= 2 ? 'green' : 'red');

function playerId() {
  let id = localStorage.getItem('trainiator_pid');
  if (!id) { id = crypto.randomUUID(); localStorage.setItem('trainiator_pid', id); }
  return id;
}

async function verifyRound({ serverSeed, roundId, commitHash, crashPoint }) {
  const RTP = 0.94, INSTANT = 0;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${serverSeed}:${roundId}`));
  const hex = [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, '0')).join('');
  const h = parseInt(hex.slice(0, 13), 16) / 2 ** 52;
  let crash;
  if (h < INSTANT) crash = 1;
  else { const u = (h - INSTANT) / (1 - INSTANT); crash = Math.max(1, Math.floor((1 + RTP * (1 / (1 - u) - 1)) * 100) / 100); }
  return { hashOk: hex === commitHash, crashOk: Math.abs(crash - crashPoint) < 1e-9 };
}

function VerifyModal({ reveal, onClose }) {
  const [res, setRes] = useState(null);
  useEffect(() => { if (reveal) verifyRound(reveal).then(setRes); }, [reveal]);
  const ok = res && res.hashOk && res.crashOk;
  return (
    <div className="modal" onClick={onClose}>
      <motion.div className="modal-card" onClick={(e) => e.stopPropagation()} initial={{ scale: 0.92, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>
        <div className="modal-title">Provably Fair · departure #{reveal?.roundId}</div>
        <p className="muted">The crash point is committed (hashed) before bets, then derived from the seed revealed after. Re-derived here in your browser:</p>
        <div className="kv"><span>commit hash</span><span className="mono">{short(reveal?.commitHash)}</span></div>
        <div className="kv"><span>revealed seed</span><span className="mono">{short(reveal?.serverSeed)}</span></div>
        <div className="kv"><span>crash point</span><span>{reveal?.crashPoint?.toFixed(2)}x</span></div>
        <div className={`verify-result ${ok ? 'ok' : res ? 'bad' : ''}`}>{!res ? 'verifying…' : ok ? '✓ verified — hash matches & crash point re-derives exactly' : '✗ mismatch'}</div>
        <button className="btn ghost" onClick={onClose}>Close</button>
      </motion.div>
    </div>
  );
}

function NameModal({ onStart }) {
  const [name, setName] = useState('');
  return (
    <div className="modal">
      <motion.div className="modal-card" initial={{ scale: 0.92, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>
        <div className="modal-title">All aboard</div>
        <p className="muted">Pick a rider name. Fake currency only — it's a demo, no real money anywhere.</p>
        <input className="name-input" autoFocus maxLength={20} placeholder="your name" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && name.trim() && onStart(name.trim())} />
        <ul className="how-to">
          <li>Place a bet during boarding.</li>
          <li>Cash out before the train derails — the longer you wait, the higher the payout.</li>
          <li>Every round is provably fair; verify any of them.</li>
        </ul>
        <button className="btn bet" disabled={!name.trim()} onClick={() => onStart(name.trim())}>Start riding</button>
      </motion.div>
    </div>
  );
}

function SettingsModal({ volume, setVolume, muted, setMuted, reduced, setReduced, onClose }) {
  return (
    <div className="modal" onClick={onClose}>
      <motion.div className="modal-card" onClick={(e) => e.stopPropagation()} initial={{ scale: 0.92, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>
        <div className="modal-title">Settings</div>
        <label className="set-row"><span>Volume</span><input type="range" min="0" max="1" step="0.05" value={volume} onChange={(e) => setVolume(Number(e.target.value))} /></label>
        <label className="set-row"><span>Mute</span><input type="checkbox" checked={muted} onChange={(e) => setMuted(e.target.checked)} /></label>
        <label className="set-row"><span>Reduce motion</span><input type="checkbox" checked={reduced} onChange={(e) => setReduced(e.target.checked)} /></label>
        <button className="btn ghost" onClick={onClose}>Close</button>
      </motion.div>
    </div>
  );
}

const RoundsBar = memo(function RoundsBar({ history, onOpen }) {
  const items = [...(history ?? [])].reverse();
  return (
    <div className="rounds-bar">
      <div className="rounds-scroll">
        <AnimatePresence initial={false}>
          {items.map((h) => (
            <motion.span key={h.roundId} layout initial={{ opacity: 0, scaleX: 0, width: 0, marginRight: 0 }} animate={{ opacity: 1, scaleX: 1, width: 'auto', marginRight: 6 }} exit={{ opacity: 0 }} transition={{ type: 'spring', stiffness: 480, damping: 34 }} className={`round-pill ${pillClass(h.crashPoint)}`}>
              {h.crashPoint.toFixed(2)}x
            </motion.span>
          ))}
        </AnimatePresence>
      </div>
      <button className="pf-chip" onClick={onOpen} title="Provably fair">✓ fair</button>
    </div>
  );
});

export default function App() {
  const [state, setState] = useState(null);
  const [balance, setBalance] = useState(null);
  const [activeBet, setActiveBet] = useState(null);
  const [stats, setStats] = useState({ streak: null, freeBets: 0 });
  const [riders, setRiders] = useState([]);
  const [presence, setPresence] = useState(0);
  const [board, setBoard] = useState([]);
  const [myBets, setMyBets] = useState([]);
  const [toasts, setToasts] = useState([]);
  const [message, setMessage] = useState('');
  const [win, setWin] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [stake, setStake] = useState('10');
  const [auto, setAuto] = useState('');
  const [muted, setMutedState] = useState(false);
  const [volume, setVolumeState] = useState(0.5);
  const [reduced, setReduced] = useState(false);
  const [verifyReveal, setVerifyReveal] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [name, setName] = useState(() => localStorage.getItem('trainiator_name') || '');
  const [showName, setShowName] = useState(() => !localStorage.getItem('trainiator_name'));
  const pid = useRef(playerId());
  const liveMultiplierRef = useRef(1);
  const reveals = useRef(new Map());
  const bettingTotal = useRef(5);
  const activeBetRef = useRef(null); // read stake in handlers without re-subscribing
  const nameRef = useRef(name); nameRef.current = name;

  const addToast = (text, kind = '') => { const id = Date.now() + Math.random(); setToasts((t) => [...t, { id, text, kind }]); setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200); };

  useEffect(() => {
    const hello = () => { if (nameRef.current) socket.emit('hello', { id: pid.current, name: nameRef.current }); };
    const onConnect = hello;
    const onState = (s) => {
      liveMultiplierRef.current = s.multiplier ?? 1;
      if (s.phase === 'crashed') reveals.current.set(s.roundId, { roundId: s.roundId, commitHash: s.commitHash, serverSeed: s.serverSeed, crashPoint: s.crashPoint });
      setState(s);
    };
    const onWallet = ({ balance }) => setBalance(balance);
    const onStats = (s) => setStats({ streak: s.streak ?? null, freeBets: s.freeBets ?? 0 });
    const onRiders = (list) => setRiders(list);
    const onPresence = ({ online }) => setPresence(online);
    const onBoard = (list) => setBoard(list);
    const onResult = (r) => {
      if (!r.ok) return setMessage(r.error || 'action failed');
      if (typeof r.balance === 'number') setBalance(r.balance);
      if ('streak' in r || 'freeBets' in r) setStats((p) => ({ streak: 'streak' in r ? r.streak : p.streak, freeBets: r.freeBets ?? p.freeBets }));
      if (r.type === 'bet') { setActiveBet({ stake: r.stake, auto: r.autoCashout, cashedAt: null, payout: 0, busted: false, free: r.free, roundId: r.roundId }); activeBetRef.current = { stake: r.stake }; setMessage(`bet ${money(r.stake)} placed${r.free ? ' · 🎟 free' : ''}`); }
      else if (r.type === 'cashout') {
        setActiveBet((b) => (b ? { ...b, cashedAt: r.multiplier, payout: r.payout } : b));
        setWin({ payout: r.payout, id: Date.now() }); sound.cashDing(); addToast(`Cashed out ${r.multiplier.toFixed(2)}x · +${money(r.payout)}`, 'win');
        setMyBets((h) => [{ roundId: r.roundId, stake: activeBetRef.current?.stake ?? 0, won: true, payout: r.payout }, ...h].slice(0, 50));
      } else if (r.type === 'crash') {
        setActiveBet((b) => (b ? { ...b, busted: true } : b));
        setMyBets((h) => [{ roundId: r.roundId, stake: r.lost, won: false }, ...h].slice(0, 50));
        if (r.nearMiss) addToast('So close! 😩', 'miss');
        if (r.reward === 'freeBet') addToast('🎟 Free bet earned!', 'reward');
        setMessage(`derailed @ ${r.crashPoint.toFixed(2)}x · −${money(r.lost)}`);
      } else if (r.type === 'topup') addToast(`Topped up +${money(r.amount)}`, 'win');
    };
    socket.on('connect', onConnect); socket.on('state', onState); socket.on('wallet', onWallet); socket.on('stats', onStats);
    socket.on('riders', onRiders); socket.on('presence', onPresence); socket.on('leaderboard', onBoard); socket.on('result', onResult);
    if (socket.connected) hello();
    return () => { socket.off('connect', onConnect); socket.off('state', onState); socket.off('wallet', onWallet); socket.off('stats', onStats); socket.off('riders', onRiders); socket.off('presence', onPresence); socket.off('leaderboard', onBoard); socket.off('result', onResult); };
  }, []);

  const phase = state?.phase ?? 'connecting';
  useEffect(() => { if (phase === 'running') sound.whistle(); else if (phase === 'crashed') sound.derail(); }, [phase]);
  useEffect(() => { if (state?.phase === 'betting') { setActiveBet(null); activeBetRef.current = null; setMessage(''); bettingTotal.current = Math.max(1, (state.bettingEndsAt - Date.now()) / 1000); } }, [state?.roundId]);
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 100); return () => clearInterval(id); }, []);
  useEffect(() => { if (win) { const t = setTimeout(() => setWin(null), 1100); return () => clearTimeout(t); } }, [win]);

  const multiplier = state?.multiplier ?? 1;
  const countdown = phase === 'betting' && state?.bettingEndsAt ? Math.max(0, (state.bettingEndsAt - now) / 1000) : null;
  const canBet = phase === 'betting' && !activeBet && Number(stake) >= 1;
  const canCashOut = phase === 'running' && activeBet && activeBet.cashedAt == null && !activeBet.busted;

  const doUnlock = () => sound.unlock();
  const startName = (n) => { localStorage.setItem('trainiator_name', n); setName(n); setShowName(false); socket.emit('hello', { id: pid.current, name: n }); };
  const placeBet = () => { doUnlock(); socket.emit('bet', { stake: Number(stake), autoCashout: auto === '' ? null : Number(auto) }); };
  const cashOut = () => socket.emit('cashout');
  const topUp = () => socket.emit('topup');
  const bump = (d) => setStake((s) => String(Math.max(1, (Number(s) || 0) + d)));
  const setMuted = (m) => { doUnlock(); setMutedState(m); sound.setMuted(m); };
  const setVolume = (v) => { doUnlock(); setVolumeState(v); sound.setVolume(v); if (muted && v > 0) setMuted(false); };
  const openVerify = (roundId) => { const rv = reveals.current.get(roundId); if (rv) setVerifyReveal(rv); };

  return (
    <MotionConfig reducedMotion={reduced ? 'always' : 'user'}>
      <div className="app">
        <header className="topbar">
          <h1>TRAINIATOR</h1>
          <span className="muted online">{presence} online</span>
          {stats.streak?.count > 1 ? <span className={`streak ${stats.streak.type}`}>{stats.streak.type === 'win' ? '🔥' : '❄️'} {stats.streak.count}{stats.streak.type === 'win' ? 'W' : 'L'}</span> : null}
          {stats.freeBets > 0 ? <span className="freebets">🎟 {stats.freeBets}</span> : null}
          <button className="icon-btn" onClick={() => setShowSettings(true)}>settings</button>
          <span className="balance">balance<strong>{money(balance)}</strong></span>
          {balance != null && balance < 10 ? <button className="topup-btn" onClick={topUp}>+ top up</button> : null}
        </header>

        <RoundsBar history={state?.history} onOpen={() => { const last = [...reveals.current.values()].pop(); if (last) setVerifyReveal(last); }} />

        <div className="layout">
          <LiveBets multiplier={multiplier} phase={phase} roundId={state?.roundId ?? 0} riders={riders} myId={pid.current} myBets={myBets} onVerify={openVerify} />

          <section className="main-col">
            <section className={`stage phase-${phase}`}>
              <TrainScene multiplierRef={liveMultiplierRef} phase={phase} crashPoint={phase === 'crashed' ? state.crashPoint : null} roundId={state?.roundId ?? 0} />
              <div className="stage-overlay">
                <div className="multiplier">{multiplier.toFixed(2)}x</div>
                <div className="phase-label">
                  {phase === 'betting' && countdown != null ? `boarding — ${countdown.toFixed(1)}s` : phase === 'crashed' ? 'flew the rails!' : phase}
                  {state?.roundId ? ` · departure #${state.roundId}` : ''}
                </div>
                {phase === 'betting' && countdown != null ? <div className="pace-bar"><div className="pace-fill" style={{ width: `${Math.min(100, (countdown / bettingTotal.current) * 100)}%` }} /></div> : null}
                <AnimatePresence>{win ? <motion.div key={win.id} className="win-float" initial={{ opacity: 0, y: 8, scale: 0.8 }} animate={{ opacity: 1, y: -46, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: 1 }}>+{money(win.payout)}</motion.div> : null}</AnimatePresence>
              </div>
            </section>

            <section className="betpanel">
              <div className="fields">
                <label>stake
                  <div className="stake-row">
                    <button className="step" onClick={() => bump(-1)} disabled={!!activeBet}>−</button>
                    <input type="number" min="1" step="1" value={stake} onChange={(e) => setStake(e.target.value)} disabled={!!activeBet} />
                    <button className="step" onClick={() => bump(1)} disabled={!!activeBet}>+</button>
                  </div>
                  <div className="chips">{[10, 25, 50, 100].map((v) => <button key={v} className="chip-btn" onClick={() => setStake(String(v))} disabled={!!activeBet}>{v}</button>)}</div>
                </label>
                <label>auto cash-out<input type="number" min="1.01" step="0.1" placeholder="e.g. 2.0" value={auto} onChange={(e) => setAuto(e.target.value)} disabled={!!activeBet} /></label>
              </div>
              {canCashOut ? (
                <button className="btn cashout" onClick={cashOut}>Cash out {multiplier.toFixed(2)}x · {money(Number((activeBet.stake * multiplier).toFixed(2)))}</button>
              ) : (
                <button className="btn bet" onClick={placeBet} disabled={!canBet}>{activeBet ? (activeBet.cashedAt != null ? 'Cashed out ✓' : activeBet.busted ? 'Derailed' : 'On board…') : stats.freeBets > 0 ? 'Place FREE bet 🎟' : 'Place bet'}</button>
              )}
              <div className="message">{message || ' '}</div>
            </section>
          </section>

          <aside className="right-rail">
            <div className="rail-card">
              <div className="rail-title">Top wins today</div>
              {board.length === 0 ? <span className="muted">no wins yet</span> : board.map((b, i) => (
                <div className="board-row" key={i}><span className="board-rank">{i + 1}</span><span className="board-name">{b.name}</span><span className="board-pay">+{money(b.payout)}</span></div>
              ))}
            </div>
          </aside>
        </div>

        <div className="toasts">
          <AnimatePresence>
            {toasts.map((t) => <motion.div key={t.id} className={`toast ${t.kind}`} initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 30 }}>{t.text}</motion.div>)}
          </AnimatePresence>
        </div>

        <AnimatePresence>{verifyReveal ? <VerifyModal reveal={verifyReveal} onClose={() => setVerifyReveal(null)} /> : null}</AnimatePresence>
        {showSettings ? <SettingsModal volume={volume} setVolume={setVolume} muted={muted} setMuted={setMuted} reduced={reduced} setReduced={setReduced} onClose={() => setShowSettings(false)} /> : null}
        {showName ? <NameModal onStart={startName} /> : null}
      </div>
    </MotionConfig>
  );
}
