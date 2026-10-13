// The rules of Pazaak, shared by the server (which enforces them) and the
// browser (which previews what a card would do before you play it).
// Nothing in here touches the network, the DOM or a clock.

export const TARGET = 20;
export const BOARD_SLOTS = 9;
export const HAND_SIZE = 4;
export const SIDE_DECK_SIZE = 10;
export const POOL_SIZE = 24;
export const WINS_NEEDED = 3;

/**
 * Every side card that can turn up in the selection pool, with its weight.
 * The odds of any one card are its weight over the total.
 *
 *   Plus / minus   common     +1/+2 most often, +5/+6 noticeably less
 *   Plus/minus     uncommon   ±2 ±3 ±4 several times more often than ±5 ±6
 *   2&4, 3&6, D    rare
 *   ±1 T           rare, and never more than one in a pool
 */
const COMMON = { 1: 10, 2: 10, 3: 9, 4: 8, 5: 6, 6: 5 };
const UNCOMMON = { 1: 3, 2: 5, 3: 5, 4: 4, 5: 1.2, 6: 1 };

export const CATALOG = [
  ...[1, 2, 3, 4, 5, 6].map((v) => ({ kind: 'plus', v, weight: COMMON[v], rarity: 'common' })),
  ...[1, 2, 3, 4, 5, 6].map((v) => ({ kind: 'minus', v, weight: COMMON[v], rarity: 'common' })),
  ...[1, 2, 3, 4, 5, 6].map((v) => ({ kind: 'pm', v, weight: UNCOMMON[v], rarity: 'uncommon' })),
  { kind: 'flip', v: 24, weight: 1.4, rarity: 'rare' },
  { kind: 'flip', v: 36, weight: 1.4, rarity: 'rare' },
  { kind: 'double', v: 0, weight: 1.4, rarity: 'rare' },
  { kind: 'tie', v: 1, weight: 1, rarity: 'rare' },
];

export const TOTAL_WEIGHT = CATALOG.reduce((sum, c) => sum + c.weight, 0);

const KIND_ORDER = { plus: 0, minus: 1, pm: 2, flip: 3, double: 4, tie: 5 };

/** Sorts side cards the way the selection screen lays them out. */
export const cardOrder = (a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.v - b.v;

export const rarityOf = (card) => CATALOG.find((c) => c.kind === card.kind && c.v === card.v)?.rarity ?? 'common';

/** The face of a side card: "+3", "-2", "±4", "2&4", "D", "±1T". */
export function label(card) {
  switch (card.kind) {
    case 'plus':
      return `+${card.v}`;
    case 'minus':
      return `−${card.v}`;
    case 'pm':
      return `±${card.v}`;
    case 'flip':
      return card.v === 24 ? '2&4' : '3&6';
    case 'double':
      return 'D';
    case 'tie':
      return '±1T';
    default:
      return '?';
  }
}

export function describe(card) {
  switch (card.kind) {
    case 'plus':
      return `Adds ${card.v} to your total.`;
    case 'minus':
      return `Takes ${card.v} off your total.`;
    case 'pm':
      return `Add or subtract ${card.v}, your choice when you play it.`;
    case 'flip':
      return card.v === 24
        ? 'Flips the sign of every 2 and 4 on your board.'
        : 'Flips the sign of every 3 and 6 on your board.';
    case 'double':
      return 'Doubles the main deck card you drew this turn.';
    case 'tie':
      return 'Plays as +1 or −1. If the set ends level, you win it instead of a draw.';
    default:
      return '';
  }
}

/** Does playing this card ask the player to pick + or −? */
export const needsSign = (card) => card.kind === 'pm' || card.kind === 'tie';

/** Picks one entry from the catalog by weight. `rand` returns a float in [0, 1). */
export function weightedPick(rand, catalog = CATALOG) {
  const total = catalog.reduce((sum, c) => sum + c.weight, 0);
  let roll = rand() * total;
  for (const c of catalog) {
    roll -= c.weight;
    if (roll < 0) return c;
  }
  return catalog[catalog.length - 1];
}

/**
 * The 24 cards a player chooses their side deck from. Repeats are allowed
 * (a pool can hold two +3s; each is its own card), but there is never more
 * than one ±1T in a pool.
 */
export function makePool(rand, newId, size = POOL_SIZE) {
  const pool = [];
  let hasTie = false;
  while (pool.length < size) {
    const pick = weightedPick(rand, hasTie ? CATALOG.filter((c) => c.kind !== 'tie') : CATALOG);
    if (pick.kind === 'tie') hasTie = true;
    pool.push({ id: newId(), kind: pick.kind, v: pick.v });
  }
  return pool.sort(cardOrder);
}

// ───────────────────────── the board ─────────────────────────
// A board card: { id, src: 'main' | 'side', kind, v (printed value),
// value (what it counts for now), flipped, label }

export const total = (board) => board.reduce((sum, c) => sum + c.value, 0);

/** The main deck card most recently drawn onto this board, or null. */
export const lastMain = (board) => [...board].reverse().find((c) => c.src === 'main') ?? null;

/**
 * What playing `card` (with `sign` for ± cards) would do to `board`.
 * Returns { board, placed, flippedIds, error }. Never changes its input.
 */
export function applySide(board, card, sign = 1, mainId = null) {
  if (board.length >= BOARD_SLOTS) return { error: 'Your board is full.' };
  const s = sign < 0 ? -1 : 1;
  const next = board.map((c) => ({ ...c }));
  const placed = { id: card.id, src: 'side', kind: card.kind, v: card.v, value: 0, flipped: false };
  let flippedIds = [];
  switch (card.kind) {
    case 'plus':
      placed.value = card.v;
      break;
    case 'minus':
      placed.value = -card.v;
      break;
    case 'pm':
    case 'tie':
      placed.value = s * card.v;
      placed.sign = s;
      break;
    case 'flip': {
      const hits = card.v === 24 ? [2, 4] : [3, 6];
      for (const c of next) {
        if (c.value !== 0 && hits.includes(Math.abs(c.value))) {
          c.value = -c.value;
          c.flipped = !c.flipped;
          flippedIds.push(c.id);
        }
      }
      break;
    }
    case 'double': {
      const target = mainId ? next.find((c) => c.id === mainId) : null;
      if (!target) return { error: 'Draw a main deck card first.' };
      placed.value = target.value;
      placed.doubles = target.id;
      break;
    }
    default:
      return { error: 'That card cannot be played.' };
  }
  next.push(placed);
  return { board: next, placed, flippedIds };
}

/** Every way a hand card could be played: [{ sign, total }]. */
export function outcomes(board, card, mainId) {
  const signs = needsSign(card) ? [1, -1] : [1];
  const out = [];
  for (const sign of signs) {
    const r = applySide(board, card, sign, mainId);
    if (!r.error) out.push({ sign, total: total(r.board), board: r.board });
  }
  return out;
}

/**
 * Who takes a set once both players have stood (or the set is otherwise
 * finished). `a` and `b`: { total, count, tie, bust }. Returns 'a', 'b' or null
 * for a draw, plus the reason.
 */
export function settle(a, b) {
  if (a.bust && b.bust) return { winner: a.bustFirst ? 'b' : 'a', reason: 'bust' };
  if (a.bust) return { winner: 'b', reason: 'bust' };
  if (b.bust) return { winner: 'a', reason: 'bust' };
  const aFull = a.count >= BOARD_SLOTS;
  const bFull = b.count >= BOARD_SLOTS;
  if (aFull && !bFull) return { winner: 'a', reason: 'full' };
  if (bFull && !aFull) return { winner: 'b', reason: 'full' };
  if (a.total > b.total) return { winner: 'a', reason: 'higher' };
  if (b.total > a.total) return { winner: 'b', reason: 'higher' };
  if (a.tie && !b.tie) return { winner: 'a', reason: 'tiebreaker' };
  if (b.tie && !a.tie) return { winner: 'b', reason: 'tiebreaker' };
  return { winner: null, reason: 'tie' };
}

/** A fresh main deck: four of every value from 1 to 10. */
export function mainDeck() {
  const deck = [];
  for (let v = 1; v <= 10; v++) for (let i = 0; i < 4; i++) deck.push(v);
  return deck;
}
