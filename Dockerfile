# Trainiator — multi-stage build. Fake-currency demo; one persistent Node process.
# Stage 1 builds the React/Vite frontend; stage 2 runs the server with prod deps only.
# Node pinned exactly: node:sqlite is experimental and its API can shift between minors.

# ---- stage 1: build the frontend (-> /app/web/dist) ----
FROM node:22.21.0-slim AS web
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# ---- stage 2: runtime ----
FROM node:22.21.0-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.js admin.html ./
COPY src/ ./src/
COPY --from=web /app/web/dist ./web/dist
# SQLite lives under data/. Mount a persistent volume at /app/data to keep
# wallets/history across deploys; otherwise it resets each deploy (fine for a demo).
EXPOSE 3000
CMD ["node", "--disable-warning=ExperimentalWarning", "server.js"]
