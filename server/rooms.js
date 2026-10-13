// Rooms: who is in them, who is sitting at the table, the match being played,
// the clocks that move it along, and saving it all to disk.

import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, randomInt } from 'node:crypto';
import { config, log } from './config.js';
import { roomCode, normalizeCode, text } from './names.js';
import * as game from './game.js';
import * as bot from './bot.js';
import * as R from '../public/js/rules.js';

const HOST_HANDOVER_MS = 45_000;
const CHAT_KEEP = 80;
const CHAT_MAX = 200;
const NAME_MAX = 18;
const CLOCKS = [0, 20, 30, 45, 60];
const EMOTES = ['pazaak', 'gg', 'lucky', 'ouch', 'think', 'wow'];

const now = () => Date.now();
const newId = () => randomBytes(6).toString('base64url');
const rand = () => randomInt(2 ** 32) / 2 ** 32;
const ctx = () => ({ rand, newId, now: now() });

export function cleanName(raw) {
  return text(raw)
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX);
}

const defaultSettings = () => ({ clock: 0 });

export const live = (room) => Boolean(room.match && room.match.phase !== 'over');
export const humansOnline = (room) => [...room.players.values()].some((p) => p.online && !p.bot);

export class Rooms {
  constructor() {
    this.rooms = new Map();
    this.savedAt = null;
    this.saveError = null;
    this.saveTimer = null;
    this.report = () => {};
    this.file = path.join(config.dataDir, 'rooms.json');
  }

  // ───────────────────────── lifecycle ─────────────────────────

  create() {
    if (this.rooms.size >= config.maxRooms) this.sweep(true);
    if (this.rooms.size >= config.maxRooms) return null;
    let code = roomCode();
    while (this.rooms.has(code)) code = roomCode();
    const room = {
      code,
      createdAt: now(),
      lastActive: now(),
      expiry: null,
      hostId: null,
      settings: defaultSettings(),
      players: new Map(),
      seats: [null, null],
      match: null,
      record: {}, // matches won in this room, by player id
      rematch: [],
      chat: [],
    };
    this.rooms.set(code, room);
    this.touch(room);
    this.report('room.created', { code });
    return room;
  }

  get(code) {
    return this.rooms.get(code);
  }

  expiresAt(room) {
    if (room.expiry === 'never') return null;
    if (Number.isFinite(room.expiry)) return room.expiry;
    return room.lastActive + config.roomTtlHours * 3600_000;
  }

  setExpiry(room, mode) {
    if (mode === 'never') room.expiry = 'never';
    else {
      room.expiry = null;
      room.lastActive = now();
    }
    this.scheduleSave();
  }

  remove(room, { notice = null, why = 'removed' } = {}) {
    if (this.rooms.get(room.code) !== room) return false;
    this.clearTimers(room);
    room.gone = true;
    this.rooms.delete(room.code);
    for (const p of room.players.values()) {
      for (const socket of p.sockets) {
        try {
          if (notice) socket.send(JSON.stringify({ t: 'fatal', code: 'closed', m: notice }));
          socket.close(4004, 'room closed');
        } catch {}
      }
      p.sockets = new Set();
    }
    this.report('room.removed', { code: room.code, why });
    this.scheduleSave();
    return true;
  }

  touch(room) {
    room.lastActive = now();
    this.scheduleSave();
  }

  /** Drops rooms whose time is up. A room someone is in is never removed. */
  sweep(aggressive = false) {
    for (const room of [...this.rooms.values()]) {
      if (humansOnline(room)) continue;
      const at = this.expiresAt(room);
      const due = at != null && now() > at;
      if (due || (aggressive && room.expiry == null && now() - room.lastActive > 3600_000)) {
        this.remove(room, { why: due ? 'expired' : 'made room' });
      }
    }
  }

  // ───────────────────────── connections ─────────────────────────

  connect(room, { token, name, ip = null }, socket) {
    let player = [...room.players.values()].find((p) => p.token === token);
    if (!player) {
      const nick = cleanName(name);
      if (!nick) return { code: 'name', error: 'Pick a name to join.' };
      if (room.players.size >= config.maxPlayers) return { code: 'full', error: 'This room is full.' };
      player = {
        id: newId(),
        token,
        name: this.freeName(room, nick),
        bot: false,
        online: false,
        sockets: new Set(),
        joinedAt: now(),
        seenAt: now(),
      };
      room.players.set(player.id, player);
      // Walk into an empty chair, if there is one and no match is running.
      const free = room.seats.indexOf(null);
      if (free >= 0 && !live(room)) room.seats[free] = player.id;
    } else if (name && cleanName(name) && cleanName(name) !== player.name) {
      player.name = this.freeName(room, cleanName(name), player.id);
    }
    socket.ip = ip;
    player.sockets.add(socket);
    player.online = true;
    player.autopilot = false;
    player.seenAt = now();
    try {
      socket.send(JSON.stringify({ t: 'chat', all: room.chat }));
    } catch {}
    this.ensureHost(room);
    this.sync(room);
    this.touch(room);
    return { player };
  }

  disconnect(room, player, socket) {
    player.sockets.delete(socket);
    if (room.gone || player.sockets.size > 0) return;
    player.online = false;
    player.seenAt = now();
    if (player.id === room.hostId) {
      setTimeout(() => {
        if (this.ensureHost(room)) this.broadcast(room);
      }, HOST_HANDOVER_MS + 500).unref?.();
    }
    this.sync(room);
    this.touch(room);
    this.broadcast(room);
  }

  ensureHost(room) {
    const host = room.players.get(room.hostId);
    if (host && !host.bot && (host.online || now() - host.seenAt < HOST_HANDOVER_MS)) return false;
    const next = [...room.players.values()].filter((p) => p.online && !p.bot).sort((a, b) => a.joinedAt - b.joinedAt)[0];
    if (!next || next.id === room.hostId) return false;
    room.hostId = next.id;
    return true;
  }

  freeName(room, name, exceptId) {
    const taken = new Set([...room.players.values()].filter((p) => p.id !== exceptId).map((p) => p.name.toLowerCase()));
    if (!taken.has(name.toLowerCase())) return name;
    for (let n = 2; n < 100; n++) {
      const candidate = `${name.slice(0, NAME_MAX - 3)} ${n}`;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
    return `${name.slice(0, 12)} ${randomInt(1000)}`;
  }

  // ───────────────────────── what each person sees ─────────────────────────

  /**
   * The room as one person may see it. Your own hand and pool are yours
   * alone; the other side's hand leaves the server as backs until the match
   * is over, when whatever they never played is turned face up.
   */
  viewFor(room, me) {
    const m = room.match;
    let match = null;
    if (m) {
      const players = {};
      for (const pid of m.order) {
        const p = m.players[pid];
        const mine = pid === me.id;
        const reveal = mine || m.phase === 'over';
        players[pid] = {
          wins: p.wins,
          locked: p.locked,
          pool: mine && m.phase === 'draft' ? p.pool : null,
          deck: mine ? p.deck : null,
          hand: p.hand.map((c) => (reveal ? c : { id: c.id, used: c.used, hidden: true, ...(c.used ? usedFace(m, pid, c.id) : {}) })),
        };
      }
      const s = m.set;
      match = {
        id: m.id,
        phase: m.phase,
        order: m.order,
        setNo: m.setNo,
        winner: m.winner,
        reason: m.reason,
        history: m.history,
        events: m.events,
        seq: m.seq,
        step: m.step ? { type: m.step.type, at: m.step.at, pid: m.step.pid ?? null } : null,
        players,
        set: s
          ? {
              no: s.no,
              starter: s.starter,
              turn: s.turn,
              turnNo: s.turnNo,
              played: s.played,
              mainId: s.mainId,
              over: s.over,
              result: s.result,
              deadline: s.deadline ?? null,
              sides: Object.fromEntries(
                m.order.map((pid) => {
                  const side = s.sides[pid];
                  return [pid, { board: side.board, total: R.total(side.board), standing: side.standing, bust: side.bust, tie: side.tie }];
                }),
              ),
            }
          : null,
      };
    }
    return {
      code: room.code,
      now: now(),
      you: me.id,
      hostId: room.hostId,
      settings: room.settings,
      seats: room.seats,
      record: room.record,
      rematch: room.rematch,
      players: [...room.players.values()]
        .sort((a, b) => a.joinedAt - b.joinedAt)
        .map((p) => ({ id: p.id, name: p.name, online: p.online, bot: p.bot, level: p.level ?? null, autopilot: Boolean(p.autopilot) })),
      match,
    };
  }

  broadcast(room) {
    for (const player of room.players.values()) {
      if (!player.sockets.size) continue;
      const payload = JSON.stringify({ t: 'state', s: this.viewFor(room, player) });
      for (const socket of player.sockets) if (socket.readyState === 1) socket.send(payload);
    }
  }

  // ───────────────────────── the clock and the computer ─────────────────────────

  clearTimers(room) {
    clearTimeout(room.stepTimer);
    clearTimeout(room.botTimer);
    clearTimeout(room.clockTimer);
    room.stepTimer = room.botTimer = room.clockTimer = null;
  }

  /** Is this seat played by the computer right now? */
  automatic(room, pid) {
    const p = room.players.get(pid);
    return Boolean(p && (p.bot || p.autopilot));
  }

  levelOf(room, pid) {
    const p = room.players.get(pid);
    return p?.bot ? p.level : 'normal';
  }

  /** Sets every timer the room needs from its current state. */
  sync(room) {
    this.clearTimers(room);
    const m = room.match;
    if (!m || m.phase === 'over' || room.gone) return;

    if (m.step) {
      room.stepTimer = setTimeout(() => {
        if (room.gone || !room.match) return;
        if (game.runStep(room.match, ctx())) this.changed(room);
        else this.sync(room);
      }, Math.max(0, m.step.at - now()));
      room.stepTimer.unref?.();
      return;
    }

    if (m.phase === 'draft') {
      const waiting = m.order.filter((pid) => !m.players[pid].locked && this.automatic(room, pid));
      if (waiting.length) {
        room.botTimer = setTimeout(() => {
          for (const pid of waiting) {
            if (m.players[pid].locked) continue;
            game.lockDeck(m, pid, bot.draft(m.players[pid].pool, this.levelOf(room, pid), rand), ctx());
          }
          this.changed(room);
        }, 1800 + randomInt(1600));
        room.botTimer.unref?.();
      }
      return;
    }

    const s = m.set;
    if (m.phase !== 'play' || !s || s.over || !s.turn) return;
    const pid = s.turn;

    if (this.automatic(room, pid)) {
      if (room.plan?.turnKey !== `${s.no}:${s.turnNo}`) {
        room.plan = { turnKey: `${s.no}:${s.turnNo}`, moves: bot.decide(m, pid, this.levelOf(room, pid), rand) };
      }
      const delay = config.botDelayMs * (0.8 + rand() * 0.5);
      room.botTimer = setTimeout(() => this.botMove(room), delay);
      room.botTimer.unref?.();
      return;
    }

    // A human's turn: the clock, if the room uses one.
    if (room.settings.clock && !s.deadline) s.deadline = now() + room.settings.clock * 1000;
    if (s.deadline) {
      room.clockTimer = setTimeout(() => {
        if (room.gone || room.match !== m || s.turn !== pid) return;
        game.timeout(m, pid, ctx());
        this.changed(room);
      }, Math.max(0, s.deadline - now()));
      room.clockTimer.unref?.();
    }
  }

  botMove(room) {
    const m = room.match;
    const s = m?.set;
    if (!s || s.over || !s.turn || !room.plan) return;
    const pid = s.turn;
    if (room.plan.turnKey !== `${s.no}:${s.turnNo}` || !room.plan.moves.length) {
      room.plan = null; // a stale plan: think again
      return this.sync(room);
    }
    const move = room.plan.moves.shift();
    let err = null;
    if (move.a === 'play') err = game.playCard(m, pid, move.id, move.sign, ctx());
    else if (move.a === 'stand') err = game.stand(m, pid, ctx());
    else err = game.endTurn(m, pid, ctx());
    if (err) {
      // Whatever went wrong, never leave the table hanging.
      room.plan.moves = [];
      game.endTurn(m, pid, ctx());
    }
    this.changed(room);
  }

  /** After anything moved: the clock, the record, everyone's screens, the save file. */
  changed(room) {
    const m = room.match;
    if (m?.set && m.set.turn && m.set.deadlineTurn !== `${m.set.no}:${m.set.turnNo}`) {
      m.set.deadline = null;
      m.set.deadlineTurn = `${m.set.no}:${m.set.turnNo}`;
    }
    if (m && m.phase === 'over' && !m.recorded) {
      m.recorded = true;
      room.record[m.winner] = (room.record[m.winner] ?? 0) + 1;
      room.rematch = [];
      this.report('match.over', { code: room.code });
    }
    this.sync(room);
    this.broadcast(room);
    this.touch(room);
  }

  // ───────────────────────── the table ─────────────────────────

  startMatch(room) {
    const [a, b] = room.seats;
    if (!a || !b) return 'Two players need to sit down first.';
    if (live(room)) return 'A match is already being played.';
    room.match = game.newMatch([a, b], ctx());
    room.rematch = [];
    room.plan = null;
    this.report('match.started', { code: room.code });
    return null;
  }

  addBot(room, level, seatNo) {
    if (live(room)) return 'Wait for this match to finish.';
    const seat = Number.isInteger(seatNo) && room.seats[seatNo] === null ? seatNo : room.seats.indexOf(null);
    if (seat < 0) return 'Both seats are taken.';
    const lvl = bot.LEVELS[level] ? level : 'normal';
    let p = [...room.players.values()].find((x) => x.bot && x.level === lvl);
    if (p && room.seats.includes(p.id)) return 'That opponent is already at the table.';
    if (!p) {
      p = { id: newId(), token: null, name: this.freeName(room, bot.LEVELS[lvl].name), bot: true, level: lvl, online: true, sockets: new Set(), joinedAt: now(), seenAt: now() };
      room.players.set(p.id, p);
    }
    room.seats[seat] = p.id;
    return null;
  }

  /** Every action a person can take. Returns an error message, or null. */
  act(room, me, msg) {
    const a = text(msg.a);
    const host = room.hostId === me.id;
    const m = room.match;
    const c = ctx();
    let err = null;

    switch (a) {
      case 'name': {
        const nick = cleanName(msg.name);
        if (!nick) return 'Names need a letter or two.';
        me.name = this.freeName(room, nick, me.id);
        break;
      }
      case 'sit': {
        if (live(room)) return 'Wait for this match to finish.';
        if (room.seats.includes(me.id)) return null;
        const seat = Number.isInteger(msg.seat) && room.seats[msg.seat] === null ? msg.seat : room.seats.indexOf(null);
        if (seat < 0) return 'Both seats are taken.';
        room.seats[seat] = me.id;
        break;
      }
      case 'leave-seat': {
        const i = room.seats.indexOf(me.id);
        if (i < 0) return null;
        if (live(room)) return 'Forfeit the match before leaving the table.';
        room.seats[i] = null;
        room.rematch = room.rematch.filter((id) => id !== me.id);
        break;
      }
      case 'add-bot': {
        if (!host && !room.seats.includes(me.id)) return 'Only the host can invite a computer player.';
        err = this.addBot(room, text(msg.level), msg.seat);
        if (err) return err;
        // Practice: a computer opponent and an empty table start straight away.
        if (msg.start && room.seats.every(Boolean)) err = this.startMatch(room);
        break;
      }
      case 'clear-seat': {
        if (!host) return 'Only the host can do that.';
        if (live(room)) return 'Wait for this match to finish.';
        const i = Number(msg.seat);
        if (!(i === 0 || i === 1) || !room.seats[i]) return null;
        room.seats[i] = null;
        break;
      }
      case 'start': {
        if (!host && !room.seats.includes(me.id)) return 'Only the host or a seated player can start.';
        err = this.startMatch(room);
        break;
      }
      case 'rematch': {
        if (!room.seats.includes(me.id)) return 'Only the two players can ask for a rematch.';
        if (live(room)) return null;
        if (!room.rematch.includes(me.id)) room.rematch.push(me.id);
        const humans = room.seats.filter((pid) => pid && !room.players.get(pid)?.bot);
        if (room.seats.every(Boolean) && humans.every((pid) => room.rematch.includes(pid))) err = this.startMatch(room);
        break;
      }
      case 'settings': {
        if (!host) return 'Only the host can change the settings.';
        const clock = Number(msg.clock);
        if (CLOCKS.includes(clock)) room.settings.clock = clock;
        break;
      }
      case 'autopilot': {
        // Someone at the table has gone quiet: let the computer play their hand until they return.
        const target = room.players.get(text(msg.pid));
        if (!target || target.bot || target.online) return 'They are still here.';
        if (!host && !room.seats.includes(me.id)) return 'Only the host or the other player can do that.';
        if (!m || !m.order.includes(target.id)) return null;
        target.autopilot = true;
        room.plan = null;
        break;
      }
      case 'lock':
        if (!m) return 'There is no match.';
        err = game.lockDeck(m, me.id, msg.ids, c);
        break;
      case 'play':
        if (!m) return 'There is no match.';
        err = game.playCard(m, me.id, text(msg.id), Number(msg.sign), c);
        break;
      case 'end':
        if (!m) return 'There is no match.';
        err = game.endTurn(m, me.id, c);
        break;
      case 'stand':
        if (!m) return 'There is no match.';
        err = game.stand(m, me.id, c);
        break;
      case 'forfeit':
        if (!m) return 'There is no match.';
        err = game.forfeit(m, me.id, c);
        break;
      case 'say':
        return this.say(room, me, msg);
      default:
        return 'Unknown action.';
    }
    if (err) return err;
    this.changed(room);
    return null;
  }

  say(room, me, msg) {
    const at = now();
    me.said = (me.said ?? []).filter((t) => at - t < 10_000);
    if (me.said.length >= 6) return 'Slow down a little.';
    const emote = EMOTES.includes(text(msg.emote)) ? text(msg.emote) : null;
    const body = emote ? '' : text(msg.text).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, CHAT_MAX);
    if (!emote && !body) return null;
    me.said.push(at);
    const line = { id: newId(), by: me.id, name: me.name, text: body, emote, at };
    room.chat.push(line);
    if (room.chat.length > CHAT_KEEP) room.chat.splice(0, room.chat.length - CHAT_KEEP);
    const payload = JSON.stringify({ t: 'chat', m: line });
    for (const p of room.players.values()) for (const s of p.sockets) if (s.readyState === 1) s.send(payload);
    this.scheduleSave();
    return null;
  }

  // ───────────────────────── saving ─────────────────────────

  scheduleSave() {
    if (!config.persist || this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.save();
    }, 1500);
    this.saveTimer.unref?.();
  }

  serialize() {
    return [...this.rooms.values()].map((room) => {
      const { players, stepTimer, botTimer, clockTimer, plan, gone, ...rest } = room;
      return { ...rest, players: [...players.values()].map(({ sockets, said, ...p }) => ({ ...p, online: Boolean(p.bot) })) };
    });
  }

  save() {
    if (!config.persist) return;
    try {
      fs.mkdirSync(config.dataDir, { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ version: 1, savedAt: now(), rooms: this.serialize() }));
      fs.renameSync(tmp, this.file);
      this.savedAt = now();
      this.saveError = null;
    } catch (err) {
      this.saveError = err.message;
      log.warn(`Could not save rooms: ${err.message}`);
    }
  }

  load() {
    if (!config.persist) return;
    let data;
    try {
      data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      return;
    }
    const downFor = now() - (data.savedAt ?? now());
    for (const saved of data.rooms ?? []) {
      const due = this.expiresAt(saved);
      if (due != null && now() > due) continue;
      const room = {
        ...saved,
        settings: { ...defaultSettings(), ...saved.settings },
        seats: Array.isArray(saved.seats) ? saved.seats : [null, null],
        record: saved.record ?? {},
        rematch: saved.rematch ?? [],
        chat: Array.isArray(saved.chat) ? saved.chat.slice(-CHAT_KEEP) : [],
        players: new Map(saved.players.map((p) => [p.id, { ...p, online: Boolean(p.bot), autopilot: false, sockets: new Set() }])),
      };
      // Time stood still while the server was down.
      const m = room.match;
      if (m?.step) m.step.at += downFor;
      if (m?.set?.deadline) m.set.deadline += downFor;
      this.rooms.set(room.code, room);
      this.sync(room);
    }
    this.savedAt = data.savedAt ?? null;
    log.info(`Restored ${this.rooms.size} rooms from disk`);
  }
}

// (Kept here so the admin page and tests can name a room the same way.)
export { normalizeCode };

/** Looks up what a used hand card was, from the board it was played onto. */
function usedFace(m, pid, id) {
  const board = m.set?.sides?.[pid]?.board ?? [];
  const c = board.find((x) => x.id === id);
  return c ? { kind: c.kind, v: c.v } : {};
}
