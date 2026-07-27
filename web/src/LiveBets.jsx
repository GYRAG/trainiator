import { memo, useEffect, useMemo, useRef, useState } from 'react';

// Riders panel. "All" shows REAL players broadcast by the server (yours
// highlighted), padded with a few SIMULATED riders so the field feels alive when
// the room is quiet (clearly cosmetic — fake currency, they only react to the
// live multiplier). "Mine" shows your settled bets with a provably-fair verify.

const NAMES = ['d***7', 'Ro***a', 'k***9', 'Mar***', 's***1', 'Ali***', 'p***x', 'Jen***', 'b***4', 'Vik***', 'n***0', 'Sam***', 't***z', 'Lu***a', 'g***5', 'Ay***', 'r***8', 'Om***', 'e***3', 'Ni***o'];
const STAKES = [1, 2, 2.5, 5, 5, 10, 10, 20, 25, 50, 3, 7.5, 15];
const rand = (a) => a[Math.floor(Math.random() * a.length)];
const money = (n) => Number(n).toFixed(2);

function makeBots(n) {
  const pool = [...NAMES].sort(() => Math.random() - 0.5).slice(0, n);
  return pool.map((name, i) => {
    const r = Math.random();
    const target = r < 0.55 ? 1.2 + Math.random() * 1.6 : r < 0.85 ? 2.8 + Math.random() * 3 : 6 + Math.random() * 20;
    return { id: `bot-${name}-${i}`, name, stake: rand(STAKES), target: Math.round(target * 100) / 100, cashedAt: null, lost: false, bot: true };
  });
}

const Row = memo(function Row({ r, me }) {
  const cls = r.cashedAt ? 'won' : r.lost ? 'lost' : '';
  return (
    <div className={`rider ${cls} ${me ? 'me' : ''}`}>
      <span className="rider-name">{me ? 'You' : r.name}</span>
      <span className="rider-stake">{money(r.stake)}</span>
      <span className="rider-mult">{r.cashedAt ? `${r.cashedAt.toFixed(2)}x` : ''}</span>
      <span className="rider-payout">{r.cashedAt ? `+${money(r.stake * r.cashedAt)}` : ''}</span>
    </div>
  );
});

function LiveBetsBase({ multiplier, phase, roundId, riders, myId, myBets, onVerify }) {
  const [bots, setBots] = useState([]);
  const [tab, setTab] = useState('all');
  const genRound = useRef(-1);

  useEffect(() => {
    if (phase === 'betting' && genRound.current !== roundId) { genRound.current = roundId; setBots(makeBots(8 + Math.floor(Math.random() * 6))); }
  }, [phase, roundId]);
  useEffect(() => {
    if (phase === 'running') setBots((bs) => bs.map((b) => (!b.cashedAt && !b.lost && multiplier >= b.target ? { ...b, cashedAt: b.target } : b)));
    else if (phase === 'crashed') setBots((bs) => bs.map((b) => (b.cashedAt ? b : { ...b, lost: true })));
  }, [multiplier, phase]);

  const real = riders ?? [];
  const all = useMemo(() => [...real, ...bots], [real, bots]);
  const total = all.reduce((s, r) => s + r.stake, 0);
  const cashed = all.filter((r) => r.cashedAt).length;

  return (
    <aside className="live-bets">
      <div className="lb-tabs">
        <button className={tab === 'all' ? 'on' : ''} onClick={() => setTab('all')}>All riders</button>
        <button className={tab === 'mine' ? 'on' : ''} onClick={() => setTab('mine')}>My bets</button>
      </div>
      {tab === 'all' ? (
        <>
          <div className="lb-head"><span>{all.length} riders</span><span className="muted">{cashed} out · {money(total)} aboard</span></div>
          <div className="lb-cols"><span>rider</span><span>bet</span><span>x</span><span>win</span></div>
          <div className="lb-list">
            {all.map((r) => <Row key={r.id} r={r} me={r.id === myId} />)}
          </div>
        </>
      ) : (
        <>
          <div className="lb-head"><span>your bets</span><span className="muted">{myBets.length} rounds</span></div>
          <div className="lb-cols"><span>round</span><span>bet</span><span>result</span><span>verify</span></div>
          <div className="lb-list">
            {myBets.length === 0 ? <span className="muted" style={{ padding: '8px 6px' }}>no bets yet</span> : null}
            {myBets.map((b) => (
              <div className={`rider ${b.won ? 'won' : 'lost'}`} key={b.roundId}>
                <span className="rider-name">#{b.roundId}</span>
                <span className="rider-stake">{money(b.stake)}</span>
                <span className="rider-mult">{b.won ? `+${money(b.payout)}` : `−${money(b.stake)}`}</span>
                <span className="rider-payout"><button className="verify-link" aria-label={`verify round #${b.roundId}`} title={`verify round #${b.roundId}`} onClick={() => onVerify(b.roundId)}>✓</button></span>
              </div>
            ))}
          </div>
        </>
      )}
    </aside>
  );
}

export const LiveBets = memo(LiveBetsBase);
