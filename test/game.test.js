import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../public/js/rules.js';
import * as game from '../server/game.js';
import * as bot from '../server/bot.js';

let ids = 0;
const newId = () => `c${++ids}`;
function seeded(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
const ctxAt = (rand, now) => ({ rand, newId, now });

// ───────────── rarity ─────────────

test('pools hold 24 cards, sorted, with at most one tiebreaker', () => {
  const rand = seeded(7);
  for (let i = 0; i < 3000; i++) {
    const pool = R.makePool(rand, newId);
    assert.equal(pool.length, 24);
    assert.ok(pool.filter((c) => c.kind === 'tie').length <= 1);
    const sorted = [...pool].sort(R.cardOrder);
    assert.deepEqual(pool.map((c) => c.id), sorted.map((c) => c.id));
  }
});

test('rarity tiers come out in the intended proportions', () => {
  const rand = seeded(42);
  const count = {};
  const n = 200_000;
  for (let i = 0; i < n; i++) {
    const c = R.weightedPick(rand);
    const key = `${c.kind}${c.v}`;
    count[key] = (count[key] ?? 0) + 1;
  }
  const share = (k) => (count[k] ?? 0) / n;
  // Commons beat uncommons beat rares.
  assert.ok(share('plus1') > share('pm3') * 1.6);
  assert.ok(share('pm3') > share('double0') * 2.5);
  // +5/+6 rarer than +1/+2; ±5/±6 much rarer than ±2..±4.
  assert.ok(share('plus6') < share('plus1') * 0.6);
  assert.ok(share('pm6') < share('pm3') * 0.3);
  // About one rare card per pool of 24.
  const rarePerPool = 24 * (share('flip24') + share('flip36') + share('double0') + share('tie1'));
  assert.ok(rarePerPool > 0.8 && rarePerPool < 1.3, `rare per pool ${rarePerPool}`);
});

// ───────────── board rules ─────────────

const main = (v, id = newId()) => ({ id, src: 'main', kind: 'main', v, value: v, flipped: false });

test('flip cards turn 2s and 4s (or 3s and 6s) over, both ways', () => {
  const board = [main(2), main(4), main(5), { id: 'x', src: 'side', kind: 'minus', v: 4, value: -4 }];
  const r = R.applySide(board, { id: 'f', kind: 'flip', v: 24 });
  assert.deepEqual(r.board.map((c) => c.value), [-2, -4, 5, 4, 0]);
  assert.equal(r.flippedIds.length, 3);
  const r2 = R.applySide([main(3), main(6), main(9)], { id: 'g', kind: 'flip', v: 36 });
  assert.equal(R.total(r2.board), -3 - 6 + 9);
});

test('the double card doubles the main card drawn this turn', () => {
  const m = main(7, 'm1');
  const r = R.applySide([main(5), m], { id: 'd', kind: 'double', v: 0 }, 1, 'm1');
  assert.equal(R.total(r.board), 5 + 14);
});

test('settling a set', () => {
  const s = (total, extra = {}) => ({ total, count: 3, tie: false, bust: false, ...extra });
  assert.deepEqual(R.settle(s(19), s(18)), { winner: 'a', reason: 'higher' });
  assert.deepEqual(R.settle(s(19), s(19)), { winner: null, reason: 'tie' });
  assert.deepEqual(R.settle(s(19, { tie: true }), s(19)), { winner: 'a', reason: 'tiebreaker' });
  assert.deepEqual(R.settle(s(19, { tie: true }), s(19, { tie: true })), { winner: null, reason: 'tie' });
  assert.deepEqual(R.settle(s(15, { count: 9 }), s(20)), { winner: 'a', reason: 'full' });
  assert.deepEqual(R.settle(s(22, { bust: true }), s(12)), { winner: 'b', reason: 'bust' });
});

// ───────────── a match ─────────────

function freshMatch(seed) {
  const rand = seeded(seed);
  let now = 1_000_000;
  const m = game.newMatch(['A', 'B'], ctxAt(rand, now));
  return { m, rand, tick: (ms = 10_000) => (now += ms), ctx: () => ctxAt(rand, now) };
}

test('side decks: exactly ten distinct cards from your own pool', () => {
  const { m, ctx } = freshMatch(3);
  const pool = m.players.A.pool;
  assert.match(game.lockDeck(m, 'A', pool.slice(0, 9).map((c) => c.id), ctx()), /exactly 10/);
  assert.match(game.lockDeck(m, 'A', [...pool.slice(0, 9).map((c) => c.id), pool[0].id], ctx()), /exactly 10/);
  assert.match(game.lockDeck(m, 'A', [...pool.slice(0, 9).map((c) => c.id), m.players.B.pool[0].id], ctx()), /not in your pool/);
  assert.equal(game.lockDeck(m, 'A', pool.slice(0, 10).map((c) => c.id), ctx()), null);
  assert.equal(m.phase, 'draft');
  assert.equal(game.lockDeck(m, 'B', m.players.B.pool.slice(5, 15).map((c) => c.id), ctx()), null);
  assert.equal(m.phase, 'deal');
  for (const pid of ['A', 'B']) {
    assert.equal(m.players[pid].hand.length, 4);
    for (const c of m.players[pid].hand) assert.ok(m.players[pid].deck.some((d) => d.id === c.id));
  }
});

function playOut(seed, levels = { A: 'hard', B: 'normal' }) {
  const { m, rand, tick, ctx } = freshMatch(seed);
  for (const pid of m.order) game.lockDeck(m, pid, bot.draft(m.players[pid].pool, levels[pid], rand), ctx());
  let guard = 0;
  while (m.phase !== 'over' && guard++ < 5000) {
    if (m.step) {
      tick();
      game.runStep(m, ctx());
      continue;
    }
    const s = m.set;
    assert.ok(s && s.turn, 'someone must be on turn');
    const pid = s.turn;
    for (const move of bot.decide(m, pid, levels[pid], rand)) {
      if (m.set.turn !== pid) break;
      const err =
        move.a === 'play' ? game.playCard(m, pid, move.id, move.sign, ctx()) : move.a === 'stand' ? game.stand(m, pid, ctx()) : game.endTurn(m, pid, ctx());
      assert.equal(err, null, `bot move ${JSON.stringify(move)} failed: ${err}`);
    }
    // Invariants after every turn.
    for (const p of m.order) {
      assert.ok(m.set.sides[p].board.length <= R.BOARD_SLOTS);
      assert.ok(m.players[p].hand.filter((c) => c.used).length <= 4);
    }
  }
  assert.equal(m.phase, 'over');
  return m;
}

test('computer players finish whole matches, first to three sets', () => {
  const wins = { A: 0, B: 0 };
  for (let seed = 1; seed <= 400; seed++) {
    const m = playOut(seed, { A: 'normal', B: 'easy' });
    assert.equal(m.players[m.winner].wins, 3);
    assert.ok(m.players[game.other(m, m.winner)].wins < 3);
    wins[m.winner] += 1;
  }
  // The normal computer beats the easy one comfortably.
  assert.ok(wins.A > wins.B * 2.5, `normal ${wins.A} vs easy ${wins.B}`);
  for (let seed = 1; seed <= 200; seed++) playOut(seed, { A: 'hard', B: 'hard' });
});

test('reaching 20 stands you automatically; standing passes play to the other side', () => {
  const { m, ctx, tick } = freshMatch(11);
  for (const pid of m.order) game.lockDeck(m, pid, m.players[pid].pool.slice(0, 10).map((c) => c.id), ctx());
  tick();
  game.runStep(m, ctx()); // set 1
  tick();
  game.runStep(m, ctx()); // first draw
  const s = m.set;
  const me = s.turn;
  const opp = game.other(m, me);
  // Rig the board: 14 + a drawn 6 = 20.
  s.sides[me].board = [main(10), main(4)];
  s.sides[me].deck.push(6);
  s.turn = null;
  game.startTurn(m, me, ctx());
  assert.equal(s.sides[me].standing, true);
  assert.equal(m.step.type, 'turn');
  assert.equal(m.step.pid, opp);
  // The opponent stands on less: the set is decided.
  tick();
  game.runStep(m, ctx());
  game.stand(m, opp, ctx());
  if (R.total(s.sides[opp].board) < 20) assert.equal(s.result.winner, me);
});

test('over 20 with no way back calls the set after a pause', () => {
  const { m, ctx, tick } = freshMatch(5);
  for (const pid of m.order) game.lockDeck(m, pid, m.players[pid].pool.slice(0, 10).map((c) => c.id), ctx());
  tick();
  game.runStep(m, ctx());
  tick();
  game.runStep(m, ctx());
  const s = m.set;
  const me = s.turn;
  for (const c of m.players[me].hand) c.used = true; // nothing left to play
  s.sides[me].board = [main(10), main(9)];
  s.sides[me].deck.push(5);
  s.turn = null;
  game.startTurn(m, me, ctx());
  assert.equal(m.step.type, 'bust');
  tick();
  game.runStep(m, ctx());
  assert.equal(s.over, true);
  assert.equal(s.result.reason, 'bust');
  assert.equal(s.result.winner, game.other(m, me));
});

test('one hand card per turn, and spent cards stay spent', () => {
  const { m, ctx, tick } = freshMatch(9);
  for (const pid of m.order) game.lockDeck(m, pid, m.players[pid].pool.slice(0, 10).map((c) => c.id), ctx());
  tick();
  game.runStep(m, ctx());
  tick();
  game.runStep(m, ctx());
  const me = m.set.turn;
  m.set.sides[me].board = [main(2)];
  const [a, b] = m.players[me].hand;
  a.kind = 'plus';
  a.v = 1;
  b.kind = 'plus';
  b.v = 2;
  assert.equal(game.playCard(m, me, a.id, 1, ctx()), null);
  assert.match(game.playCard(m, me, b.id, 1, ctx()), /already played a card/);
  assert.equal(game.endTurn(m, me, ctx()), null);
  assert.match(game.playCard(m, me, b.id, 1, ctx()), /not your turn/);
});
