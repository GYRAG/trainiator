// Trainiator server — Express + socket.io. Authoritative game loop, per-player
// wallets, live riders broadcast, presence, faucet, leaderboard. Fake currency
// only — there is no real money anywhere in this project.
import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { createGame } from './src/engine.js';
import { createDb } from './src/db.js';
import { createRetention } from './src/retention.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FAUCET = { amount: 500, minBalance: 10, cooldownMs: 60_000 }; // fake-coin top-up
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'trainiator-dev';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: true } }); // dev; prod is same-origin

const db = createDb(process.env.DB_PATH || 'data/trainiator.sqlite');
const retention = createRetention({ store: db });

const sockets = new Map(); // playerId -> socket (route per-player results)

const game = createGame({
  onState: (state) => io.emit('state', state),
  store: db,
  retention,
  onPlayerResult: (playerId, result) => sockets.get(playerId)?.emit('result', result),
  onRiders: (riders) => io.emit('riders', riders), // everyone sees the live field
});

const cleanName = (n) => String(n || '').replace(/[^\w .\-]/g, '').trim().slice(0, 20) || 'anon';
const broadcastPresence = () => io.emit('presence', { online: sockets.size });
const sendLeaderboard = (target) => target.emit('leaderboard', db.leaderboard(8));

// Simple per-socket rate limit: max ~10 actions/second.
function allow(socket) {
  const now = Date.now();
  const rl = socket.data.rl || (socket.data.rl = { count: 0, start: now });
  if (now - rl.start > 1000) { rl.start = now; rl.count = 0; }
  return ++rl.count <= 10;
}

io.on('connection', (socket) => {
  let playerId = null;

  socket.on('hello', ({ id, name } = {}) => {
    playerId = String(id || '').slice(0, 64);
    if (!playerId) return;
    socket.data.playerId = playerId;
    socket.data.name = cleanName(name);
    sockets.set(playerId, socket);
    const balance = db.ensurePlayer(playerId, game.config.startingBalance, socket.data.name);
    socket.emit('wallet', { balance });
    socket.emit('stats', retention.startSession(playerId));
    socket.emit('state', game.getState());
    socket.emit('riders', game.getRiders());
    sendLeaderboard(socket);
    broadcastPresence();
  });

  socket.on('bet', ({ stake, autoCashout } = {}) => {
    if (playerId && allow(socket)) socket.emit('result', game.placeBet(playerId, stake, autoCashout, socket.data.name));
  });

  socket.on('cashout', () => {
    if (playerId && allow(socket)) socket.emit('result', game.cashOut(playerId));
  });

  socket.on('topup', () => {
    if (!playerId || !allow(socket)) return;
    const r = db.topUp(playerId, FAUCET);
    if (r.ok) socket.emit('wallet', { balance: r.balance });
    socket.emit('result', r.ok ? { ok: true, type: 'topup', balance: r.balance, amount: FAUCET.amount } : { ok: false, error: r.error });
  });

  socket.on('disconnect', () => {
    if (playerId && sockets.get(playerId) === socket) { sockets.delete(playerId); broadcastPresence(); }
  });

  socket.emit('state', game.getState()); // snapshot for immediate sync
});

// keep the leaderboard fresh for everyone
setInterval(() => sendLeaderboard(io), 15_000);

app.get('/healthz', (_req, res) => res.json({ ok: true, online: sockets.size }));

// --- internal admin (token-gated; set ADMIN_TOKEN in production) ---
const adminAuth = (req, res, next) => ((req.get('x-admin-token') || req.query.token) === ADMIN_TOKEN ? next() : res.status(401).json({ error: 'unauthorized' }));
app.get('/admin/stats', adminAuth, (_req, res) => {
  const st = game.getState();
  res.json({ ...db.dashboard(), leaderboard: db.leaderboard(10), online: sockets.size, roundId: st.roundId ?? 0, phase: st.phase });
});
app.get('/admin', (_req, res) => res.sendFile(join(__dirname, 'admin.html')));

app.use(express.static('web/dist')); // prod frontend; dev is served by Vite

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`Trainiator server on http://localhost:${PORT}  (rtp=${game.config.rtp}, k=${game.config.k})`);
  if (ADMIN_TOKEN === 'trainiator-dev') console.warn('⚠  ADMIN_TOKEN is the dev default — set ADMIN_TOKEN before exposing publicly.');
  game.start();
});
