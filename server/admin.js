// The admin page at /admin: every room, who is in it, and how its match is
// going. Rooms can be kept for good or deleted. Switched off unless
// ADMIN_PASSWORD is set. Block /admin at your reverse proxy for anyone
// outside your own network as well.

import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { config, log } from './config.js';
import { normalizeCode } from './names.js';
import { live } from './rooms.js';
import * as R from '../public/js/rules.js';

const COOKIE = 'pazaak_admin';

function sameSecret(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

export function createAdmin({ rooms, sockets, clientIp, isHttps, send, readJson, securityHeaders }) {
  const sessions = new Map(); // token -> expires at
  const failures = new Map(); // ip -> [times]
  const activity = [];
  rooms.report = (kind, detail) => {
    activity.push({ at: Date.now(), kind, ...detail });
    if (activity.length > 60) activity.shift();
  };

  const cookieOf = (req) => {
    const raw = String(req.headers.cookie ?? '');
    const hit = raw.split(';').map((s) => s.trim()).find((s) => s.startsWith(`${COOKIE}=`));
    return hit ? hit.slice(COOKIE.length + 1) : '';
  };
  const signedIn = (req) => {
    const token = cookieOf(req);
    const until = sessions.get(token);
    if (!until) return false;
    if (until < Date.now()) {
      sessions.delete(token);
      return false;
    }
    return true;
  };

  function summary(room) {
    const m = room.match;
    const name = (id) => room.players.get(id)?.name ?? '—';
    return {
      code: room.code,
      createdAt: room.createdAt,
      lastActive: room.lastActive,
      expiresAt: rooms.expiresAt(room),
      keep: room.expiry === 'never',
      host: name(room.hostId),
      seats: room.seats.map((id) => (id ? { name: name(id), bot: Boolean(room.players.get(id)?.bot), online: Boolean(room.players.get(id)?.online) } : null)),
      people: [...room.players.values()].filter((p) => !p.bot).map((p) => ({ name: p.name, online: p.online, seated: room.seats.includes(p.id) })),
      match: m
        ? {
            phase: m.phase,
            live: live(room),
            setNo: m.setNo,
            score: m.order.map((pid) => ({ name: name(pid), wins: m.players[pid].wins, total: m.set ? R.total(m.set.sides[pid].board) : null })),
            winner: m.winner ? name(m.winner) : null,
          }
        : null,
      record: Object.entries(room.record).map(([pid, n]) => ({ name: name(pid), wins: n })),
    };
  }

  async function handle(req, res, pathname) {
    if (!config.adminPassword) {
      send(res, 404, 'The admin page is switched off. Set ADMIN_PASSWORD to turn it on.');
      return true;
    }
    if (pathname === '/admin' || pathname === '/admin/') {
      const html = fs.readFileSync(path.join(config.publicDir, 'admin', 'index.html'), 'utf8').replaceAll('{{BASE}}', `${config.basePath}/`);
      send(res, 200, html, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return true;
    }
    if (!pathname.startsWith('/admin/api/')) return false; // its script and styles are ordinary files

    const ip = clientIp(req);
    if (pathname === '/admin/api/login' && req.method === 'POST') {
      const recent = (failures.get(ip) ?? []).filter((t) => Date.now() - t < 10 * 60_000);
      if (recent.length >= 8) {
        send(res, 429, { error: 'Too many wrong passwords. Wait ten minutes.' });
        return true;
      }
      const body = await readJson(req);
      if (!body || !sameSecret(String(body.password ?? ''), config.adminPassword)) {
        failures.set(ip, [...recent, Date.now()]);
        log.warn(`Admin sign-in failed from ${ip}`);
        send(res, 403, { error: 'That password is not right.' });
        return true;
      }
      const token = randomBytes(24).toString('base64url');
      sessions.set(token, Date.now() + config.adminSessionHours * 3600_000);
      const secure = isHttps(req) ? '; Secure' : '';
      send(res, 200, { ok: true }, {
        'Set-Cookie': `${COOKIE}=${token}; Path=${config.basePath || '/'}; HttpOnly; SameSite=Strict; Max-Age=${config.adminSessionHours * 3600}${secure}`,
      });
      return true;
    }
    if (!signedIn(req)) {
      send(res, 401, { error: 'Sign in first.' });
      return true;
    }
    if (pathname === '/admin/api/logout' && req.method === 'POST') {
      sessions.delete(cookieOf(req));
      send(res, 200, { ok: true }, { 'Set-Cookie': `${COOKIE}=; Path=${config.basePath || '/'}; Max-Age=0` });
      return true;
    }
    if (pathname === '/admin/api/rooms' && req.method === 'GET') {
      let online = 0;
      for (const room of rooms.rooms.values()) for (const p of room.players.values()) if (p.online && !p.bot) online += 1;
      send(res, 200, {
        server: { uptime: Math.round(process.uptime()), sockets: sockets(), online, rooms: rooms.rooms.size, savedAt: rooms.savedAt, saveError: rooms.saveError, ttlHours: config.roomTtlHours },
        rooms: [...rooms.rooms.values()].sort((a, b) => b.lastActive - a.lastActive).map(summary),
        activity: activity.slice().reverse(),
      });
      return true;
    }
    const act = /^\/admin\/api\/rooms\/([^/]+)\/(delete|keep|release)$/.exec(pathname);
    if (act && req.method === 'POST') {
      const room = rooms.get(normalizeCode(decodeURIComponent(act[1])));
      if (!room) {
        send(res, 404, { error: 'That room is no longer here.' });
        return true;
      }
      if (act[2] === 'delete') rooms.remove(room, { notice: 'This room was closed by the server admin.', why: 'admin' });
      else rooms.setExpiry(room, act[2] === 'keep' ? 'never' : 'default');
      send(res, 200, { ok: true });
      return true;
    }
    send(res, 404, { error: 'Not found.' });
    return true;
  }

  return { handle, securityHeaders };
}
