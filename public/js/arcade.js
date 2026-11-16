// The au12 Arcade (github.com/au12/arcade), when Pazaak is one of its games.
//
// js/vendor/arcade.js is the arcade's own script. In the arcade's frame it
// learns who is playing; opened on its own it asks the arcade named in
// /arcade.json. Without an arcade every call here quietly does nothing.

import { store } from './sound.js';

const A = globalThis.Arcade ?? null;

/** Waits for the arcade to say who is playing, but not for long. */
export function arcadeReady(ms = 1500) {
  if (!A) return Promise.resolve(null);
  return Promise.race([A.ready, new Promise((resolve) => setTimeout(() => resolve(null), ms))]);
}

/** The arcade player's name, for the name box. */
export const arcadeName = () => (A?.player?.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 18);

/**
 * A storage key that belongs to whoever is playing, so each person at a shared
 * arcade cabinet keeps a seat and a name of their own. The first arcade player
 * on a browser keeps the plain keys (the seat they already had there); anyone
 * else, a guest in the arcade's frame and everyone on a kiosk gets their own.
 */
export function personal(key) {
  if (!A || (A.mode !== 'embedded' && A.mode !== 'direct')) return key;
  const id = A.player?.id;
  if (!id) return A.mode === 'embedded' ? `${key}@guest` : key;
  if (A.kiosk) return `${key}@${id}`;
  let owner = store.get('arcadeOwner', null);
  if (!owner) store.set('arcadeOwner', (owner = id));
  return owner === id ? key : `${key}@${id}`;
}

let lastStatus = '';
/** What the game is doing: 'menu', 'playing' or 'over'. */
export function arcadeStatus(status) {
  if (!A || status === lastStatus) return;
  lastStatus = status;
  A.status(status);
}

let lastInvite;
/** The table's link while a seat is free, shown as a QR code on the arcade cabinet. */
export function arcadeInvite(url) {
  if (!A || url === lastInvite) return;
  lastInvite = url;
  A.invite(url, url ? 'Scan to play a friend' : '');
}

const reported = new Set();

/**
 * Reports a match you played and saw end: a win or a loss, against whom (a
 * person, or which of the three computers) and the sets. A page opened on a
 * match that is already over, and a match you only watched, report nothing.
 */
export function arcadeReport(prev, next) {
  const a = prev?.match;
  const m = next?.match;
  if (!A || !a || !m || m.phase !== 'over' || a.id !== m.id || a.phase === 'over') return;
  const me = next.you;
  if (!m.order.includes(me) || !m.winner || reported.has(m.id)) return;
  reported.add(m.id);
  const them = m.order.find((pid) => pid !== me);
  const rival = next.players.find((p) => p.id === them);
  const meta = { vs: rival?.bot ? 'bot' : 'human', sets: `${m.players[me]?.wins ?? 0}-${m.players[them]?.wins ?? 0}` };
  if (rival?.bot && rival.level) meta.bot = rival.level;
  if (m.reason === 'forfeit') meta.forfeit = true;
  A.result(m.winner === me ? 'win' : 'loss', { meta });
}
