// One match of Pazaak between two seats, from choosing side decks to the
// third set won. The functions here change a plain `match` object and record
// what happened in `match.events`; rooms.js decides when the scheduled steps
// (the next draw, the next set) run, and who gets to see what.
//
// ctx: { rand(): [0,1), newId(): string, now: ms }

import * as R from '../public/js/rules.js';

// PACE_SCALE speeds everything up for tests (0.01 = a hundred times faster).
const scale = Math.max(0, Number(process.env.PACE_SCALE ?? 1)) || 0;
export const PACE = {
  dealMs: 3200 * scale, // both side decks locked -> first card of the first set
  turnGapMs: 750 * scale, // one turn ends -> the next player's draw
  setPauseMs: 4600 * scale, // a set is decided -> the next one starts
  autoBustMs: 1600 * scale, // over 20 with no way back -> the set is called
};

const EVENT_KEEP = 40;

function event(match, type, data = {}) {
  match.seq += 1;
  match.events.push({ n: match.seq, type, ...data });
  if (match.events.length > EVENT_KEEP) match.events.splice(0, match.events.length - EVENT_KEEP);
}

const other = (match, pid) => match.order.find((p) => p !== pid);

function shuffle(list, rand) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

// ───────────────────────── setting up ─────────────────────────

export function newMatch(order, ctx) {
  const match = {
    id: ctx.newId(),
    order: [...order],
    phase: 'draft', // draft -> deal -> play -> over
    seq: 0,
    events: [],
    players: {},
    setNo: 0,
    firstStarter: order[Math.floor(ctx.rand() * order.length)],
    set: null,
    history: [],
    step: null, // { type, pid?, at }: something that happens on its own after a pause
    winner: null,
    reason: null,
    startedAt: ctx.now,
  };
  for (const pid of order) {
    match.players[pid] = { pool: R.makePool(ctx.rand, ctx.newId), deck: [], locked: false, hand: [], wins: 0 };
  }
  event(match, 'draft');
  return match;
}

/** A player locks in the ten cards they picked from their pool. */
export function lockDeck(match, pid, ids, ctx) {
  if (match.phase !== 'draft') return 'Side decks are already chosen.';
  const me = match.players[pid];
  if (!me) return 'You are not playing in this match.';
  if (me.locked) return 'Your side deck is already locked in.';
  if (!Array.isArray(ids)) return 'Pick your cards.';
  const unique = [...new Set(ids.map(String))];
  if (unique.length !== R.SIDE_DECK_SIZE) return `Pick exactly ${R.SIDE_DECK_SIZE} cards.`;
  const cards = unique.map((id) => me.pool.find((c) => c.id === id));
  if (cards.some((c) => !c)) return 'One of those cards is not in your pool.';
  me.deck = cards.map((c) => ({ ...c })).sort(R.cardOrder);
  me.locked = true;
  event(match, 'locked', { pid });
  if (match.order.every((p) => match.players[p].locked)) deal(match, ctx);
  return null;
}

/** Four of each player's ten go to their hand, for the whole match. */
function deal(match, ctx) {
  for (const pid of match.order) {
    const me = match.players[pid];
    me.hand = shuffle(me.deck.map((c) => ({ ...c })), ctx.rand)
      .slice(0, R.HAND_SIZE)
      .map((c) => ({ ...c, used: false }));
  }
  match.phase = 'deal';
  event(match, 'deal');
  match.step = { type: 'set', at: ctx.now + PACE.dealMs };
}

// ───────────────────────── sets and turns ─────────────────────────

export function startSet(match, ctx) {
  match.setNo += 1;
  const starter = match.setNo % 2 === 1 ? match.firstStarter : other(match, match.firstStarter);
  const sides = {};
  for (const pid of match.order) {
    sides[pid] = { board: [], standing: false, bust: false, deck: shuffle(R.mainDeck(), ctx.rand), tie: false };
  }
  match.phase = 'play';
  match.set = { no: match.setNo, starter, turn: null, turnNo: 0, played: false, mainId: null, sides, over: false, result: null };
  event(match, 'set', { no: match.setNo, starter });
  match.step = { type: 'turn', pid: starter, at: ctx.now + 450 * scale };
}

/** The start of a turn: the player draws from their main deck. */
export function startTurn(match, pid, ctx) {
  const s = match.set;
  if (!s || s.over) return;
  const side = s.sides[pid];
  if (side.standing) return;
  s.turn = pid;
  s.turnNo += 1;
  s.played = false;
  match.step = null;
  if (!side.deck.length) side.deck = shuffle(R.mainDeck(), ctx.rand);
  const v = side.deck.pop();
  const card = { id: ctx.newId(), src: 'main', kind: 'main', v, value: v, flipped: false };
  side.board.push(card);
  s.mainId = card.id;
  event(match, 'draw', { pid, card, total: R.total(side.board) });
  afterChange(match, pid, ctx);
}

/** Checks a board after a card lands: twenty, a full board, or over with no way back. */
function afterChange(match, pid, ctx) {
  const s = match.set;
  const side = s.sides[pid];
  const t = R.total(side.board);
  if (side.board.length >= R.BOARD_SLOTS && t <= R.TARGET) {
    event(match, 'full', { pid });
    return finishSet(match, pid, 'full', ctx);
  }
  if (t === R.TARGET) {
    side.standing = true;
    event(match, 'stand', { pid, total: t, auto: true });
    return passTurn(match, pid, ctx);
  }
  if (t > R.TARGET && !canRescue(match, pid)) {
    match.step = { type: 'bust', pid, at: ctx.now + PACE.autoBustMs };
  }
}

/** Could one card from this player's hand still bring them back to 20 or under this turn? */
export function canRescue(match, pid) {
  const s = match.set;
  if (!s || s.played || s.turn !== pid) return false;
  const side = s.sides[pid];
  if (side.board.length >= R.BOARD_SLOTS) return false;
  return match.players[pid].hand.some((c) => !c.used && R.outcomes(side.board, c, s.mainId).some((o) => o.total <= R.TARGET));
}

export function playCard(match, pid, cardId, sign, ctx) {
  const s = match.set;
  if (match.phase !== 'play' || !s || s.over) return 'There is no set in play.';
  if (s.turn !== pid) return 'It is not your turn.';
  if (s.played) return 'You have already played a card this turn.';
  const side = s.sides[pid];
  if (side.standing) return 'You are standing.';
  const card = match.players[pid].hand.find((c) => c.id === String(cardId));
  if (!card) return 'That card is not in your hand.';
  if (card.used) return 'You have already played that card.';
  const r = R.applySide(side.board, card, sign === -1 ? -1 : 1, s.mainId);
  if (r.error) return r.error;
  side.board = r.board;
  card.used = true;
  s.played = true;
  if (card.kind === 'tie') side.tie = true;
  if (match.step?.type === 'bust' && match.step.pid === pid) match.step = null;
  event(match, 'play', { pid, card: r.placed, flipped: r.flippedIds, total: R.total(side.board) });
  afterChange(match, pid, ctx);
  return null;
}

export function endTurn(match, pid, ctx) {
  const s = match.set;
  if (match.phase !== 'play' || !s || s.over) return 'There is no set in play.';
  if (s.turn !== pid) return 'It is not your turn.';
  const side = s.sides[pid];
  if (side.standing) return 'You are standing.';
  if (R.total(side.board) > R.TARGET) return bust(match, pid, ctx);
  event(match, 'end', { pid });
  passTurn(match, pid, ctx);
  return null;
}

export function stand(match, pid, ctx) {
  const s = match.set;
  if (match.phase !== 'play' || !s || s.over) return 'There is no set in play.';
  if (s.turn !== pid) return 'It is not your turn.';
  const side = s.sides[pid];
  if (side.standing) return 'You are already standing.';
  const t = R.total(side.board);
  if (t > R.TARGET) return bust(match, pid, ctx);
  side.standing = true;
  event(match, 'stand', { pid, total: t, auto: false });
  passTurn(match, pid, ctx);
  return null;
}

function bust(match, pid, ctx) {
  const s = match.set;
  s.sides[pid].bust = true;
  event(match, 'bust', { pid, total: R.total(s.sides[pid].board) });
  finishSet(match, other(match, pid), 'bust', ctx);
  return null;
}

/** Called by the scheduler: a player over 20 with no way back. */
export function autoBust(match, pid, ctx) {
  const s = match.set;
  if (!s || s.over || s.turn !== pid) return;
  if (R.total(s.sides[pid].board) <= R.TARGET) return;
  bust(match, pid, ctx);
}

/** Hands the turn on: to the opponent, back to this player if the opponent stands, or ends the set. */
function passTurn(match, pid, ctx) {
  const s = match.set;
  const opp = other(match, pid);
  s.turn = null;
  if (s.sides[pid].standing && s.sides[opp].standing) return resolve(match, ctx);
  const next = s.sides[opp].standing ? pid : opp;
  match.step = { type: 'turn', pid: next, at: ctx.now + PACE.turnGapMs };
}

/** Both players stand: compare. */
function resolve(match, ctx) {
  const s = match.set;
  const [a, b] = match.order;
  const view = (pid) => {
    const side = s.sides[pid];
    return { total: R.total(side.board), count: side.board.length, tie: side.tie, bust: side.bust };
  };
  const result = R.settle(view(a), view(b));
  finishSet(match, result.winner === 'a' ? a : result.winner === 'b' ? b : null, result.reason, ctx);
}

function finishSet(match, winner, reason, ctx) {
  const s = match.set;
  s.over = true;
  s.turn = null;
  const totals = Object.fromEntries(match.order.map((pid) => [pid, R.total(s.sides[pid].board)]));
  s.result = { winner, reason, totals };
  if (winner) match.players[winner].wins += 1;
  match.history.push({ no: s.no, winner, reason, totals });
  event(match, 'result', { winner, reason, totals });
  const champ = match.order.find((pid) => match.players[pid].wins >= R.WINS_NEEDED);
  if (champ) return finishMatch(match, champ, 'sets', ctx);
  match.step = { type: 'set', at: ctx.now + PACE.setPauseMs };
}

function finishMatch(match, winner, reason, ctx) {
  match.phase = 'over';
  match.winner = winner;
  match.reason = reason;
  match.step = null;
  match.endedAt = ctx.now;
  if (match.set) match.set.turn = null;
  event(match, 'match', { winner, reason });
}

export function forfeit(match, pid, ctx) {
  if (match.phase === 'over') return 'The match is already over.';
  if (!match.players[pid]) return 'You are not playing in this match.';
  event(match, 'forfeit', { pid });
  finishMatch(match, other(match, pid), 'forfeit', ctx);
  return null;
}

/** Runs whatever was scheduled, if its time has come. Returns true if something ran. */
export function runStep(match, ctx) {
  const step = match.step;
  if (!step || ctx.now < step.at) return false;
  match.step = null;
  if (step.type === 'set') startSet(match, ctx);
  else if (step.type === 'turn') startTurn(match, step.pid, ctx);
  else if (step.type === 'bust') autoBust(match, step.pid, ctx);
  return true;
}

/** The turn clock ran out: end the turn (which busts anyone over 20). */
export function timeout(match, pid, ctx) {
  const s = match.set;
  if (!s || s.over || s.turn !== pid) return;
  event(match, 'timeout', { pid });
  endTurn(match, pid, ctx);
}

export { other };
