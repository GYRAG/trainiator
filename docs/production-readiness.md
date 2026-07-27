# ADR-001: Production deployment & online-testing architecture for Trainiator

**Status:** Proposed
**Date:** 2026-07-26
**Deciders:** project owner

## Context

Trainiator is a **provably-fair, train-themed crash game** — a portfolio/demo.
**Fake currency only. No real money, no payments, no financial transactions, ever.**

Current shape:

- **Backend:** one Node process (`server.js`) = Express (HTTP) + socket.io (WS) + a
  **single in-process authoritative game loop** (setInterval/setTimeout timers) that
  broadcasts one shared round to all clients. Persistence via **`node:sqlite`** (a
  file DB, `data/trainiator.sqlite`) for wallets, rounds, bets, sessions.
- **Frontend:** React + Vite (built to static `web/dist`, served by Express in prod;
  Vite dev-server proxies `/socket.io` to `:3000` in dev). GSAP canvas scene + Motion UI.
- **Multiplayer:** already works — shared loop + per-player SQLite wallets + presence +
  live riders broadcast + provably-fair verification each round.

Goal: **deploy publicly and let people test it online.** This is a demo, not a
real-money product, so the bar is "safe, stable, cheap public hosting" — not
compliance/PCI/gambling-license territory.

### Key constraints & forces

- **Stateful & long-lived:** persistent WebSocket connections + an always-running
  game-loop timer. This rules out request/response serverless for the backend.
- **Single source of game truth:** the round loop lives in one process. Running two
  instances would create two independent games. → **single backend instance** is the
  correct topology for a demo; horizontal scale is explicitly out of scope (see below).
- **Cheap / low-ops:** it's a demo; minimize moving parts and cost.
- **Public exposure:** once anyone can connect, we must harden the surface
  (unauth admin endpoint, permissive CORS, abuse limits).

## Decision

Ship as a **single containerized Node process** on a **persistent-process PaaS**
(Fly.io / Render / Railway), **serving the built frontend and the socket.io backend
from the same origin**, with SQLite on a small persistent volume. Add hardening,
health checks, config-by-env, and process-resilience before exposing it.

Same-origin serving is the linchpin: it removes CORS entirely and means the client's
default `io()` "just works" over WSS behind the platform's TLS.

## Options considered

### Option A — Single container on a persistent-process PaaS (Fly.io / Render / Railway) — **recommended**
| Dimension | Assessment |
|-----------|------------|
| Complexity | Low — one service, one Dockerfile |
| Cost | Low (free/hobby tiers exist) |
| Fit for WS + game loop | Excellent (persistent process) |
| Scalability | Single instance (correct for one shared game) |
| Ops | Minimal (platform handles TLS, restarts, logs) |

**Pros:** matches the architecture exactly; same-origin (no CORS); TLS/WSS free;
auto-restart; trivial redeploy from Git. **Cons:** single instance = a restart blips
the live round (acceptable — wallets persist in SQLite; roundId resets).

### Option B — VPS + Docker + nginx + PM2 (DigitalOcean/Hetzner)
**Pros:** full control, cheap fixed cost. **Cons:** you own TLS, restarts, security
patching, nginx WS config. Overkill ops for a demo.

### Option C — Serverless / edge (Vercel / Netlify functions)
**Rejected.** No persistent WebSocket server, no always-on game-loop timer, function
timeouts. Fundamentally incompatible with the shared-loop design.

### Option D — Split: static frontend on a CDN (Vercel/Netlify) + backend on a Node host
**Pros:** fast global static delivery. **Cons:** reintroduces cross-origin (must lock
CORS + `withCredentials`), two deploys, two hosts. Unnecessary for a demo; revisit only
if frontend delivery becomes a bottleneck.

## Trade-off analysis

The whole system hinges on the **single authoritative game loop**. That makes a single
persistent process not just acceptable but *desired*, and makes Option A the natural
fit. Options B/D add ops or cross-origin complexity for benefits (control, CDN) a demo
doesn't need. Option C is disqualified by the WS + timer requirement.

**Scaling note (out of scope, documented):** to run >1 backend instance you'd need
(a) a **socket.io Redis adapter** to fan-out broadcasts across instances, and (b) a
**single game-authority** (one instance runs the loop, or a separate loop service
publishing to Redis) so all instances serve the same round, and (c) Postgres instead of
a single-writer SQLite file. Not needed for online testing; note it and move on.

**DB choice — `node:sqlite` vs `better-sqlite3`:** `node:sqlite` is still flagged
*experimental* and its API can shift between Node minors. For a longer-lived public
deploy, **`better-sqlite3`** (stable, synchronous, battle-tested) is the safer bet — at
the cost of a native build in the image. For a short demo, `node:sqlite` on a **pinned
Node 22.x** is fine. Recommend: pin Node now; switch to better-sqlite3 if this outlives
"a demo."

**Persistence:** SQLite must live on a **persistent volume** or it resets every deploy.
For fake-currency demo data, a reset is *acceptable* (even nice for a clean slate). Use a
volume if you want history/leaderboard continuity; otherwise accept ephemeral.

## Consequences

- **Easier:** one deploy, same-origin, WSS free, redeploy = `git push`.
- **Harder / to revisit:** a process restart interrupts the in-flight round (wallets
  survive; roundId restarts at 1); no horizontal scale without the Redis+Postgres work
  above; `node:sqlite` experimental risk until swapped.

## Action items (ordered — smallest safe path to a public URL)

### 1. Harden the exposed surface (do before any public URL)
- [ ] **Protect `/admin/stats`** — require an `ADMIN_TOKEN` (header/query); it currently
      leaks internal analytics to anyone.
- [ ] **Lock CORS** — same-origin serving means socket.io needs no permissive CORS.
      Replace `cors: { origin: true }` with `origin: process.env.CLIENT_ORIGIN ?? false`.
- [ ] **Helmet** for HTTP security headers (CSP allowing the app's own scripts + WS).
- [ ] **socket.io limits** — `maxHttpBufferSize: 1e4`, sane `pingTimeout`; keep the
      existing per-socket action rate-limit + `maxBet` + faucet cooldown.
- [ ] **Process resilience** — `uncaughtException` / `unhandledRejection` handlers (log,
      then exit so the platform restarts); wrap the tick/settlement in try/catch so one
      bad round can't kill the loop.

### 2. Build & run for production
- [ ] **Root `build` script** — `cd web && npm ci && npm run build` (produces `web/dist`).
- [ ] **`/healthz`** endpoint (platform health checks + uptime pings).
- [ ] **SPA fallback** — serve `index.html` for unknown GET paths.
- [ ] **Pin Node** — `"engines": { "node": ">=22.5" }` + `.nvmrc`.
- [ ] **Env config** — `PORT`, `DB_PATH`, `ADMIN_TOKEN`, `CLIENT_ORIGIN`, `NODE_ENV`;
      ship a committed `.env.example` (never the real `.env`).

### 3. Containerize
- [ ] **Multi-stage `Dockerfile`** — stage 1 builds `web/dist`; stage 2 runs the server
      with only prod deps; `EXPOSE 3000`; `CMD ["node","server.js"]`.
- [ ] **`.dockerignore`** (node_modules, web/node_modules, .env, data, .git).

### 4. Deploy
- [ ] Pick **Fly.io** or **Render**; connect the Git repo (note: remote is currently
      `GYRAG/smart-mate` — consider a dedicated repo).
- [ ] Set env vars + (optional) attach a small **persistent volume** mounted at
      `DB_PATH` for wallet/history continuity.
- [ ] First deploy → smoke test the public URL (bet, cash out, verify, two browsers).

### 5. Public-demo polish
- [ ] Visible **"Demo — fake currency, no real money or payments"** disclaimer/footer.
- [ ] Basic logging you can read in the platform's log viewer.
- [ ] (Optional) anti-farming: cap new wallets per IP; the faucet already has a cooldown.

### Not doing (documented, out of scope)
- Horizontal scaling (Redis adapter + Postgres + split game-authority).
- Real accounts/auth, payments, KYC — **explicitly never** (fake currency demo).
