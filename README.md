# 🚂 Trainiator

**A provably-fair, real-time multiplayer crash game — with an authoritative server, a verifiable RNG, and a hand-built pixel Art-Deco world.**

![Node](https://img.shields.io/badge/Node-22.x-1e2a21?style=flat-square&logo=node.js&logoColor=c9a24b)
![React](https://img.shields.io/badge/React-18-1e2a21?style=flat-square&logo=react&logoColor=c9a24b)
![Socket.IO](https://img.shields.io/badge/Socket.IO-4-1e2a21?style=flat-square&logo=socketdotio&logoColor=c9a24b)
![Vite](https://img.shields.io/badge/Vite-5-1e2a21?style=flat-square&logo=vite&logoColor=c9a24b)
![Provably&nbsp;Fair](https://img.shields.io/badge/Provably-Fair-5aa578?style=flat-square)

> **▶ Live demo:** _add your deploy URL here_
> **📹 Demo clip:** drop a ~6-second recording at `docs/demo.gif` — the train accelerating into the warp-blur past 7×, then jackknifing off the rails. It's the most striking six seconds of the project; then swap this line for `![Trainiator](docs/demo.gif)`.

> ⚠️ **Fake currency only.** No real money, payments, or financial transactions anywhere. This is a portfolio piece and technical demonstration.

---

## Why this project is interesting

- **The server is the single source of truth.** One authoritative game loop owns the clock and decides every bet, cash-out, and crash. The client only *renders* — it can't cheat the outcome.
- **The RNG is provably fair, and you can prove it in the browser.** A cryptographic commit/reveal scheme locks each crash point *before* bets and reveals the seed *after*, so anyone can re-derive the result and confirm it was never altered.
- **The house edge is honest math, not rug-pulls.** The margin is a smooth haircut on profit rather than fake instant crashes (details below).
- **Retention mechanics are quarantined from the RNG.** Streaks, near-miss flags, free bets, and variable pacing are cosmetic — none of them can reach the fairness code.
- **A distinctive, hand-built aesthetic.** A GSAP-driven pixel Art-Deco railway (parallax hills, rolling wheels, warp-speed zoom-blur, a derailment) and fully *procedural* Web Audio — no neon, no template.

---

## Provably fair

Trainiator uses a commit/reveal scheme so the crash point is fixed before anyone bets, and independently verifiable afterward.

```mermaid
sequenceDiagram
  autonumber
  participant P as Player
  participant S as Server
  Note over S: generate a secret serverSeed (32 random bytes)
  S->>P: publish commitHash = SHA-256(serverSeed : roundId)
  Note over P,S: bets are placed — the crash point is already locked
  Note over S: crashPoint is derived from that same hash
  S->>P: after the crash, reveal serverSeed + crashPoint
  Note over P: re-hash to confirm it matches commitHash,<br/>then re-derive crashPoint to prove fairness
```

Because SHA-256 is one-way, the published hash leaks nothing about the outcome — yet it commits the server to it. In the app, the **"✓ fair"** panel re-runs this entire derivation in your browser (`crypto.subtle`) and shows the **full seed and hash, click-to-copy**, so you can verify any round anywhere.

**The house edge lives in exactly one place** (`src/rng.js`) and is applied as a haircut on *profit*, so it spreads smoothly across the curve instead of concentrating in 1.00× "rug pulls":

```
fair  = 1 / (1 - u)          # zero-edge curve: ≥ 1, median 2×, heavy tail
crash = 1 + rtp · (fair - 1) # keep only `rtp` of the profit   (rtp = 0.94)
```

This yields `RTP(m) = m·rtp / (rtp + m − 1) ≤ 1` at every cash-out target `m` — the house always holds a small, provable edge, and never an unfair one.

---

## Architecture

A monolith by design: one Node process runs the HTTP server, the WebSocket server, and the authoritative game loop; the built React SPA is served from the **same origin** (so there's no CORS and WSS is free behind the platform's TLS).

```mermaid
flowchart LR
  subgraph B["Browser — React + Vite"]
    UI["App.jsx<br/>UI & bet controls"]
    Scene["TrainScene.jsx<br/>GSAP canvas"]
    Cli["socket.io-client"]
  end
  subgraph N["Node — single authoritative process"]
    IO["socket.io server"]
    Loop["engine.js<br/>round loop (source of truth)"]
    RNG["rng.js<br/>provably-fair crash point"]
    Curve["curve.js<br/>multiplier growth"]
    DB[("db.js<br/>SQLite — wallets, rounds, bets")]
  end
  Cli <-->|"state · riders · result · wallet · leaderboard"| IO
  IO --> Loop
  Loop --> RNG
  Loop --> Curve
  Loop --> DB
  UI --> Cli
  Scene -.->|"binds the live multiplier"| UI
```

| Module | Responsibility |
|--------|----------------|
| `server.js` | Express + Socket.IO wiring, presence, per-socket rate limiting, leaderboard broadcast, token-gated admin, health check, hardening. |
| `src/engine.js` | The authoritative loop: `betting → running → crashed`. Owns the clock; decides valid bets, auto-cash-outs, and settlement. Crash-safe (one bad round can't freeze the loop). |
| `src/rng.js` | The *only* place outcomes are decided. Seed generation, the SHA-256 commitment, and the crash-point curve with the RTP edge. |
| `src/curve.js` | Multiplier growth over time and the time-to-crash inverse. |
| `src/db.js` | Persistence via built-in `node:sqlite` — wallets, rounds, bets, sessions, leaderboard. |
| `src/retention.js` | Cosmetic-only streaks / free bets. Never touches the RNG. |
| `web/` | React + Vite SPA: canvas scene, live rider list, achievements, in-browser fairness verifier. |

---

## Tech stack & rationale

| Layer | Choice | Why |
|-------|--------|-----|
| Runtime | **Node 22, single process** | The game loop must own one clock — one process is one source of truth. (Horizontal scale is a documented non-goal; see the ADR.) |
| Realtime | **Socket.IO** | Broadcast/rooms, auto-reconnect, and WS-with-fallback out of the box. |
| Persistence | **`node:sqlite`** (built-in) | Zero-dependency, synchronous, single-writer — ideal for one process. Swap to `better-sqlite3`/Postgres if it outgrows a demo. |
| Fairness | **Node `crypto` (SHA-256)** | Commit/reveal needs nothing more, and it's verifiable in any language. |
| Frontend | **React 18 + Vite** | Fast HMR, small production bundle. |
| Scene | **GSAP + Canvas 2D** | A single 60 fps ticker; the live multiplier drives scroll speed, wheel roll, smoke, and the warp-blur. |
| UI motion | **Motion (Framer)** | Declarative enter/exit for toasts, modals, and history pills. |
| Audio | **Web Audio API (procedural)** | Engine chug, whistle, and derailment are synthesized at runtime — no audio files to ship. |

---

## Key engineering decisions

- **Authoritative server, untrusted client.** Every outcome is computed server-side and pushed; the browser renders and requests, but never decides. This is what makes the fairness guarantee meaningful.
- **One shared round for everyone.** A single loop broadcasts one game to all connected players (live rider field, presence, leaderboard) — real multiplayer, not per-tab simulations.
- **Fairness code is a sealed unit.** All of Part-2's retention/pacing lives outside `rng.js`; the RNG is pure and deterministic given `(seed, roundId, config)`.
- **Same-origin serving.** Express serves `web/dist` and the socket on one origin → no CORS, WSS behind the host's TLS, and `git push` redeploys the whole thing.
- **Hardened for public exposure.** Locked CORS, security headers, socket frame cap, crash-safe loop, and process handlers. See [`docs/production-readiness.md`](docs/production-readiness.md) for the full deploy/scale ADR.

---

## Running locally

**Prerequisites:** Node ≥ 22.5 (for `node:sqlite`) and npm.

```bash
# 1. install
npm install
cd web && npm install && cd ..

# 2a. dev — two processes, Vite proxies the socket to the server
npm run server          # http://localhost:3000
cd web && npm run dev   # http://localhost:5173  (proxies /socket.io -> :3000)

# 2b. or run the production shape locally
npm run build           # builds web/dist  (stop the Vite dev server first on Windows)
npm start               # server serves the built SPA on :3000
```

Run the test suite (Node's built-in runner):

```bash
npm test
```

---

## Project structure

```
server.js                  Express + Socket.IO + game wiring, hardening, admin
src/
  engine.js                authoritative round loop
  rng.js                   provably-fair crash point + house edge
  curve.js                 multiplier growth / time-to-crash
  db.js                    node:sqlite persistence
  retention.js             cosmetic streaks & free bets (never touches RNG)
  sim.js                   RTP simulation harness
test/                      unit tests (rng, curve, engine, wallet, retention)
web/
  src/
    App.jsx                UI, bet flow, achievements, fairness verifier
    TrainScene.jsx         GSAP canvas railway scene
    LiveBets.jsx           live rider field / your bet history
    sound.js               procedural Web Audio
    achievements.js        client-side cosmetic achievements
docs/production-readiness.md   deployment & scaling ADR
Dockerfile                 multi-stage production build
```

---

## Deployment

Ships as a **single containerized Node process** on a persistent-process host (Fly.io / Render / Railway), serving the built frontend and the socket from one origin, with SQLite on a small persistent volume. The multi-stage [`Dockerfile`](Dockerfile) builds the SPA and runs the server with prod-only dependencies. Full rationale, trade-offs, and the (out-of-scope) horizontal-scaling path are in the [production-readiness ADR](docs/production-readiness.md).

---

## Disclaimer

Trainiator is a **technical demonstration using fake currency only**. There is no real money, no payments, no accounts, and no financial transactions of any kind.
