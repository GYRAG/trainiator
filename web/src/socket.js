import { io } from 'socket.io-client';

// Same-origin connection: in dev, Vite proxies /socket.io to the game server.
// Created once at module load (advanced-init-once) and shared by the app.
export const socket = io();
