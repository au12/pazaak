// All configuration comes from environment variables so the same image runs
// anywhere. Every value has a sensible default.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = process.env;

const int = (name, fallback, min, max) => {
  const n = Number.parseInt(env[name] ?? '', 10);
  if (Number.isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
};

/** "/games/pazaak/" -> "/games/pazaak"; "" or "/" -> "" */
const cleanBase = (value) => {
  const trimmed = String(value ?? '').trim().replace(/^\/+|\/+$/g, '');
  return trimmed ? `/${trimmed}` : '';
};

export const config = {
  root,
  host: env.HOST || '0.0.0.0',
  port: int('PORT', 3000, 1, 65535),
  siteName: (env.SITE_NAME || 'Pazaak').slice(0, 40),
  basePath: cleanBase(env.BASE_PATH),
  publicDir: path.join(root, 'public'),
  dataDir: env.DATA_DIR || path.join(root, 'data'),
  persist: env.PERSIST !== 'false',
  // If set, people must enter this to create a room. Joining is never gated.
  createPassword: env.CREATE_PASSWORD || '',
  // The admin page at /admin. Left empty, the page is switched off.
  adminPassword: env.ADMIN_PASSWORD || '',
  adminSessionHours: int('ADMIN_SESSION_HOURS', 12, 1, 24 * 30),
  // How many reverse proxies sit in front of this server (Nginx Proxy Manager
  // counts as one). 0 = none: X-Forwarded-For is ignored.
  trustProxy: int('TRUST_PROXY', 1, 0, 10),
  trustAnyProxy: env.TRUST_PROXY_ANY === 'true',
  roomTtlHours: int('ROOM_TTL_HOURS', 48, 1, 24 * 90),
  maxRooms: int('MAX_ROOMS', 500, 1, 100000),
  maxPlayers: int('MAX_PLAYERS_PER_ROOM', 24, 2, 256),
  allowedOrigins: (env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean),
  // Computer players wait about this long before each move.
  botDelayMs: int('BOT_DELAY_MS', 1100, 0, 10000),
  messageBudget: int('MESSAGE_BUDGET', 40, 5, 100000),
  logLevel: env.LOG_LEVEL || 'info',
};

export const log = {
  info: (...a) => config.logLevel !== 'silent' && console.log(new Date().toISOString(), ...a),
  warn: (...a) => config.logLevel !== 'silent' && console.warn(new Date().toISOString(), 'WARN', ...a),
  debug: (...a) => config.logLevel === 'debug' && console.log(new Date().toISOString(), 'DEBUG', ...a),
};
