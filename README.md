# Trainiator

Trainiator is a **provably-fair, train-themed crash game**. It is designed as a portfolio piece and a technical demonstration. 

**⚠️ Important:** This project uses **fake currency only**. There is no real money, no payments, and no financial transactions involved whatsoever.

## Features

- **Real-Time Multiplayer:** Built with Socket.io, broadcasting the live game state, riders, and crash multipliers to all connected clients.
- **Provably Fair RNG:** A transparent, cryptographic commit/reveal scheme ensures the crash point is pre-determined and cannot be altered mid-game.
- **Authoritative Server:** A single Node.js game loop acts as the source of truth, enforcing game rules, wallet balances, and betting mechanics.
- **Persistent Local Database:** Uses SQLite to store user wallets, bet histories, round outcomes, and leaderboards.
- **Modern Frontend:** Built with React 19, Vite, and GSAP/Framer Motion for smooth, cinematic animations.
- **Retention & Pacing:** Includes cosmetic "near miss" notifications, variable betting windows, and a free-faucet for engagement testing without manipulating the core odds.

## Architecture

Trainiator is a monolithic repository consisting of a Node.js/Express backend and a React single-page application frontend.

### Backend Overview

- `server.js`: The entry point. Sets up the Express HTTP server, Socket.io WebSocket server, and instantiates the game engine and database. Handles player connections, rate limiting, and broadcasting presence/leaderboard stats.
- `src/engine.js`: The **Authoritative Game Loop**. This ties the RNG, curve growth, and betting mechanics together. The server owns the clock and state; it alone decides when bets are valid, when to auto-cashout, and when the round crashes.
- `src/rng.js`: The **Provably Fair RNG Engine**. The only place where outcomes are decided. Generates the server seed, the commit hash, and maps hashes to a crash multiplier curve with a defined RTP (Return to Player).
- `src/curve.js`: Handles the mathematical growth of the multiplier over time. 
- `src/db.js`: Persistence layer using `node:sqlite`. Stores wallets, bets, sessions, and the historic rounds to reconstruct the leaderboard.
- `src/retention.js`: (Optional) Cosmetic retention layer that manages streaks and rewards (like free bet tokens) without modifying core gameplay odds.

### Frontend Overview

- Located in the `web/` directory, it is a standard **React + Vite** setup.
- Communicates with the backend exclusively via Socket.io for live updates (`state`, `riders`, `result`, `wallet`, `leaderboard`).
- Handles the visual representation of the multiplier (e.g., a train moving on a track) using animation libraries bound to the broadcast multiplier.

## The Provably Fair System

Trainiator uses a cryptographic commit/reveal scheme to guarantee fairness:

1. **Commit:** Before a round starts, the server generates a secret 32-byte `serverSeed`. It then publishes a SHA-256 hash of this seed and the `roundId` (the **commitment**). Because SHA-256 is one-way, no player can derive the crash point.
2. **Lock:** The crash point is deterministically derived from this hash. Once bets are placed, the outcome is locked and cannot be manipulated by the server or players.
3. **Reveal:** After the round crashes, the server reveals the original `serverSeed`. 
4. **Verify:** Anyone can take the `serverSeed` and `roundId`, re-hash them to verify they match the original commitment, and re-calculate the crash point to prove it was fair.

*Note: The house edge is implemented as a mathematical limit on RTP (Return to Player), ensuring the casino maintains an advantage over time without resorting to unexpected instant 1.00x "rug pulls".*

## Getting Started (Development)

### Prerequisites
- Node.js (v22.5+ recommended for `node:sqlite` features)
- npm

### 1. Install Dependencies

Install the backend dependencies:
```bash
npm install
```

Install the frontend dependencies:
```bash
cd web
npm install
cd ..
```

### 2. Run the Application

You can run the backend and frontend separately for development:

**Backend (Server):**
```bash
npm run server
```
This starts the Express and Socket.io server on `http://localhost:3000`.

**Frontend (Client):**
```bash
cd web
npm run dev
```
This starts the Vite development server (usually on `http://localhost:5173`), which will proxy Socket.io requests to the backend.

### Admin Panel

The backend exposes a simple admin route at `/admin` (or `/admin/stats`). In development, it defaults to a dev token (`trainiator-dev`). You can view current server stats, online users, and leaderboard metrics.

## Production Deployment

Trainiator is designed to be deployed as a **single containerized Node process** on a persistent-process PaaS (like Fly.io or Render).

- **Same-Origin Serving:** The built React frontend (`web/dist`) is served statically by the Express backend. This removes CORS complexities and allows Socket.io to connect over the same TLS connection.
- **Single Instance Topology:** Because the authoritative game loop must reside in a single process to maintain game state, it is intended to run as a single instance.
- **Persistence:** Ensure a persistent volume is attached for the SQLite database (`data/trainiator.sqlite`) so wallets and history persist across redeploys.

For a detailed deployment strategy, see `docs/production-readiness.md`.
