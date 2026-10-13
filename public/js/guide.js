// The How to play guide: the rules, every side card, and a recorded match.

import { cardEl } from './cards.js';
import { h } from './ui.js';

const RULES = `
  <div class="guide-rules">
    <p class="guide-lede">Pazaak is played in sets. In each set you and your opponent build a total from cards on your own board, and whoever stands closest to 20 without going over takes the set. Win three sets to win the match.</p>
    <ol class="steps">
      <li><div><h3>Build a side deck</h3><p>Before the match you are shown 24 side cards. Pick 10 of them. Four of those ten, drawn at random, become your hand, and that hand has to last the whole match. A card you play is gone for good.</p></div></li>
      <li><div><h3>Draw</h3><p>Each turn starts with a green card from the main deck, worth 1 to 10, landing on your board on its own.</p></div></li>
      <li><div><h3>Play a hand card, if you want</h3><p>You may play one card from your hand per turn to push your total up or pull it back down. Tap it to see what your total would become.</p></div></li>
      <li><div><h3>End your turn, or stand</h3><p>End turn and you draw again next time. Stand and your total is locked for the rest of the set while your opponent plays on. Hit exactly 20 and you stand automatically.</p></div></li>
    </ol>
    <div class="guide-grid">
      <div class="guide-note"><h3>Going over</h3><p>End a turn above 20 and you bust: the set goes to your opponent. A minus card played in the same turn can save you.</p></div>
      <div class="guide-note"><h3>Full board</h3><p>Fill all nine spaces on your board without going over and the set is yours, even against a 20.</p></div>
      <div class="guide-note"><h3>Ties</h3><p>Stand on the same total and the set is a draw: nobody scores and a new set begins. A ±1T tiebreaker played that set wins it instead.</p></div>
      <div class="guide-note"><h3>Taking turns</h3><p>Whoever opens alternates from set to set. Once one player stands, the other keeps drawing until they stand or bust.</p></div>
    </div>
  </div>`;

const CODEX = [
  { name: 'Plus', rarity: 'common', cards: [{ kind: 'plus', v: 1 }, { kind: 'plus', v: 4 }, { kind: 'plus', v: 6 }], text: 'Add 1 to 6 to your total. The low values turn up most often; +5 and +6 are scarcer.' },
  { name: 'Minus', rarity: 'common', cards: [{ kind: 'minus', v: 2 }, { kind: 'minus', v: 3 }, { kind: 'minus', v: 5 }], text: 'Take 1 to 6 off your total. Your way back when a draw pushes you over 20.' },
  { name: 'Plus or minus', rarity: 'uncommon', cards: [{ kind: 'pm', v: 2 }, { kind: 'pm', v: 3 }, { kind: 'pm', v: 5 }], text: 'You choose the sign when you play it. ±2 to ±4 are much more common than ±5 and ±6.' },
  { name: 'Flip', rarity: 'rare', cards: [{ kind: 'flip', v: 24 }, { kind: 'flip', v: 36 }], text: 'Turns over the sign of every matching value on your board: 2&4 flips each 2 and 4, 3&6 each 3 and 6. Positives go negative and negatives go positive.' },
  { name: 'Double', rarity: 'rare', cards: [{ kind: 'double', v: 0 }], text: 'Doubles the main deck card you drew this turn. Drew a 7? The D adds another 7.' },
  { name: 'Tiebreaker', rarity: 'rare', cards: [{ kind: 'tie', v: 1 }], text: 'Plays as +1 or −1. If the set then ends level, you win it instead of a draw. Never more than one in a selection.' },
];

function cardsTab() {
  const wrap = h('div', { class: 'codex' });
  wrap.append(h('p', { class: 'guide-lede' }, 'Every selection of 24 is dealt at random, weighted by rarity: mostly plus and minus cards, a few plus-or-minus, and about one rare card per selection.'));
  for (const row of CODEX) {
    const cards = h('div', { class: 'codex-cards' }, row.cards.map((c) => cardEl(c, { rarity: true })));
    wrap.append(
      h('div', { class: 'codex-row' }, cards, h('div', {}, h('h3', {}, row.name, h('span', { class: `rarity ${row.rarity}` }, row.rarity[0].toUpperCase() + row.rarity.slice(1))), h('p', {}, row.text))),
    );
  }
  return wrap;
}

function watchTab() {
  return h(
    'div',
    { class: 'watch' },
    h('video', { src: 'media/tutorial.mp4', poster: 'media/tutorial-poster.jpg', controls: true, preload: 'none', playsinline: true }),
    h('p', {}, 'A full match from start to finish: building the side deck, drawing, playing hand cards, standing and busting. The rules here are the same.'),
  );
}

export function setupGuide() {
  const modal = document.getElementById('guide');
  const body = document.getElementById('guide-body');
  const tabs = document.getElementById('guide-tabs');
  const show = (tab) => {
    for (const b of tabs.querySelectorAll('button')) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
    body.replaceChildren();
    if (tab === 'rules') body.innerHTML = RULES;
    else if (tab === 'cards') body.append(cardsTab());
    else body.append(watchTab());
    body.scrollTop = 0;
  };
  tabs.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tab]');
    if (b) show(b.dataset.tab);
  });
  modal.addEventListener('open', () => show('rules'));
  modal.addEventListener('close', () => body.querySelector('video')?.pause());
}
