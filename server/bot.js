// The computer opponents. Three temperaments:
//   easy    stands early, forgets its hand half the time
//   normal  sensible: saves itself, stands on 18, chases a standing opponent
//   hard    counts the main cards left in its deck and what its hand could
//           rescue before pushing past 17, and drafts heavier on minus cards
//
// (Tested over thousands of computer-vs-computer matches: easy loses about
// 85% to normal. Past "sensible", Pazaak is mostly the luck of the draw: the
// hard computer's edge over normal is a couple of percent.)

import * as R from '../public/js/rules.js';
import { other } from './game.js';

export const LEVELS = {
  easy: { name: 'Tobb', title: 'Dockside hustler' },
  normal: { name: 'Vessa', title: 'Cantina regular' },
  hard: { name: 'Oru-Kaan', title: 'High-stakes shark' },
};

// How much a card is worth keeping, for choosing a side deck and for deciding what to spend.
function worth(card) {
  switch (card.kind) {
    case 'tie':
      return 100;
    case 'double':
      return 62;
    case 'pm':
      return { 1: 62, 2: 74, 3: 76, 4: 72, 5: 60, 6: 56 }[card.v];
    case 'flip':
      return 40;
    case 'minus':
      return { 1: 44, 2: 50, 3: 54, 4: 52, 5: 46, 6: 44 }[card.v];
    case 'plus':
      return { 1: 40, 2: 42, 3: 40, 4: 36, 5: 32, 6: 30 }[card.v];
    default:
      return 0;
  }
}

/** Ten cards from a pool of 24. */
export function draft(pool, level, rand) {
  const noise = level === 'easy' ? 60 : level === 'normal' ? 18 : 4;
  const scored = pool.map((c) => ({ c, s: worth(c) + rand() * noise }));
  // Keep a mix: never more than four straight plus cards.
  scored.sort((a, b) => b.s - a.s);
  const picked = [];
  let plus = 0;
  for (const { c } of scored) {
    if (picked.length >= R.SIDE_DECK_SIZE) break;
    if (c.kind === 'plus' && plus >= (level === 'hard' ? 2 : 4) && level !== 'easy') continue;
    if (c.kind === 'plus') plus += 1;
    picked.push(c);
  }
  for (const { c } of scored) {
    if (picked.length >= R.SIDE_DECK_SIZE) break;
    if (!picked.includes(c)) picked.push(c);
  }
  return picked.map((c) => c.id);
}

/** Chance the next main card takes `t` past 20, from the cards left in the deck. */
function bustChance(deck, t) {
  if (!deck.length) return t >= 11 ? (t - 10) / 10 : 0;
  return deck.filter((v) => t + v > R.TARGET).length / deck.length;
}

/**
 * What to do on this turn, after the draw. Returns a list of moves for the
 * room to make one at a time: { a: 'play', id, sign } then { a: 'stand' } or
 * { a: 'end' }.
 */
export function decide(match, pid, level, rand) {
  const s = match.set;
  const me = s.sides[pid];
  const opp = s.sides[other(match, pid)];
  const t = R.total(me.board);
  const oppT = R.total(opp.board);
  const hand = match.players[pid].hand.filter((c) => !c.used);
  const mustWin = match.players[other(match, pid)].wins === R.WINS_NEEDED - 1; // losing this set loses the match
  const canPlay = !s.played && me.board.length < R.BOARD_SLOTS;

  const options = [];
  if (canPlay) {
    for (const c of hand) {
      for (const o of R.outcomes(me.board, c, s.mainId)) options.push({ card: c, sign: o.sign, total: o.total, cost: worth(c) });
    }
  }
  const play = (o, then) => [{ a: 'play', id: o.card.id, sign: o.sign }, { a: then }];
  const cheapest = (list) => list.sort((x, y) => x.cost - y.cost)[0];
  const best = (list) => list.sort((x, y) => y.total - x.total || x.cost - y.cost)[0];

  // Easy: forgets its hand half the time, and stands early.
  if (level === 'easy') {
    if (t > R.TARGET) {
      const save = options.filter((o) => o.total <= R.TARGET);
      if (save.length && rand() < 0.6) {
        const o = save[Math.floor(rand() * save.length)];
        return play(o, o.total >= 16 ? 'stand' : 'end');
      }
      return [{ a: 'end' }];
    }
    if (opp.standing && t < oppT) return [{ a: 'end' }];
    return [{ a: t >= 16 + Math.floor(rand() * 2) ? 'stand' : 'end' }];
  }

  const risk = bustChance(me.deck, t);
  const hard = level === 'hard';
  if (hard && t <= R.TARGET && !opp.standing) {
    // Counts the cards left in its deck, and what its hand could rescue.
    const twenty = options.filter((o) => o.total === R.TARGET);
    if (twenty.length && (t >= 16 || mustWin)) return play(cheapest(twenty), 'stand');
    if (t >= 18) return [{ a: 'stand' }];
    const left = me.deck.length ? me.deck : R.mainDeck();
    const rescue = hand.filter((c) => c.kind !== 'plus');
    const fatal = left.filter((v) => {
      const nt = t + v;
      if (nt <= R.TARGET) return false;
      return !rescue.some((c) => R.outcomes([{ id: 'x', value: nt, src: 'main' }], c, 'x').some((o) => o.total <= R.TARGET && o.total >= 15));
    }).length / left.length;
    if (t === 17) return [{ a: fatal > 0.35 ? 'stand' : 'end' }];
    if (t === 16 && fatal > 0.6) return [{ a: 'stand' }];
    return [{ a: 'end' }];
  }

  // Over twenty: get back under, as high as possible.
  if (t > R.TARGET) {
    const save = options.filter((o) => o.total <= R.TARGET);
    if (!save.length) return [{ a: 'end' }];
    const o = best(save);
    if (opp.standing) return play(o, o.total > oppT || (o.total === oppT && o.total >= 18) ? 'stand' : 'end');
    return play(o, o.total >= 17 ? 'stand' : 'end');
  }

  // The opponent has stood: beat them, or keep drawing.
  if (opp.standing) {
    if (opp.bust) return [{ a: 'stand' }];
    if (t > oppT) return [{ a: 'stand' }];
    const beat = options.filter((o) => o.total > oppT && o.total <= R.TARGET);
    if (beat.length) return play(cheapest(beat), 'stand');
    if (t === oppT) {
      const tie = options.find((o) => o.card.kind === 'tie' && o.total === oppT);
      if (tie) return play(tie, 'stand');
      // Take the draw rather than risk the bust, unless the deck is kind.
      return [{ a: risk > (hard ? 0.45 : 0.5) || t >= 19 ? 'stand' : 'end' }];
    }
    return [{ a: 'end' }];
  }

  // Twenty is there for the taking.
  const twenty = options.filter((o) => o.total === R.TARGET);
  if (twenty.length && (t >= 15 || mustWin || (hard && t >= 14))) return play(cheapest(twenty), 'stand');

  if (t >= 19) return [{ a: 'stand' }];
  if (t === 18) return [{ a: hard && risk < 0.25 && oppT >= 18 ? 'end' : 'stand' }];
  if (t === 17) {
    if (hard) return [{ a: risk > 0.6 && oppT <= 17 ? 'stand' : 'end' }];
    return [{ a: rand() < 0.5 ? 'stand' : 'end' }];
  }
  // A little top-up toward 19 when it is cheap and the set matters.
  if (hard && mustWin && t >= 13) {
    const lift = options.filter((o) => o.total >= 18 && o.total <= 19 && o.card.kind !== 'tie');
    if (lift.length) return play(cheapest(lift), 'stand');
  }
  return [{ a: 'end' }];
}
