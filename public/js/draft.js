// Choosing a side deck: ten cards out of a pool of twenty-four.

import * as R from './rules.js';
import { cardEl } from './cards.js';
import { h, escapeHtml } from './ui.js';
import { sound } from './sound.js';
import * as fx from './fx.js';

const RARITY_NAME = { common: 'Common', uncommon: 'Uncommon', rare: 'Rare' };

export class Draft {
  constructor(root, app) {
    this.root = root;
    this.app = app;
    this.matchId = null;
    this.picked = [];
  }

  render(s) {
    const m = s.match;
    const mine = m.players[s.you];
    if (this.matchId !== m.id) {
      this.matchId = m.id;
      this.picked = [];
      this.build(s);
    }
    this.s = s;
    this.locked = mine.locked;
    this.update();
  }

  build(s) {
    const m = s.match;
    const pool = m.players[s.you].pool ?? [];
    this.pool = pool;
    const foe = s.players.find((p) => p.id === m.order.find((id) => id !== s.you));
    this.foeName = foe?.name ?? 'Your opponent';

    this.poolEl = h('div', { class: 'pool panel' });
    pool.forEach((c, i) => {
      const btn = h('button', { class: 'pick', style: { '--n': i }, 'data-id': c.id, 'aria-pressed': 'false', 'aria-label': `${R.label(c)}, ${R.rarityOf(c)}. ${R.describe(c)}` }, cardEl(c, { rarity: true }), h('span', { class: 'tick', 'aria-hidden': 'true' }, '✓'));
      btn.addEventListener('click', () => this.toggle(c.id));
      btn.addEventListener('pointerenter', () => this.info(c));
      btn.addEventListener('focus', () => this.info(c));
      this.poolEl.append(btn);
    });

    this.slots = Array.from({ length: R.SIDE_DECK_SIZE }, () => h('div', { class: 'slot' }));
    this.countEl = h('b', {}, '0');
    this.infoEl = h('div', { class: 'info' }, 'Point at a card to see what it does. Rare cards carry a gold star, uncommon ones a teal diamond.');
    this.foeEl = h('div', { class: 'foe-status' });
    this.lockBtn = h('button', { class: 'btn btn-amber btn-big', onclick: () => this.lock() }, 'Lock in my deck');
    this.tray = h(
      'div',
      { class: 'tray panel' },
      h('h2', {}, 'Your side deck', h('span', {}, this.countEl, ` / ${R.SIDE_DECK_SIZE}`)),
      h('div', { class: 'slots' }, this.slots),
      this.infoEl,
      h('div', { class: 'tray-buttons' }, h('button', { class: 'btn', onclick: () => this.suggest() }, 'Suggest'), h('button', { class: 'btn', onclick: () => this.clear() }, 'Clear'), this.lockBtn),
      h('div', { class: 'legend' }, h('span', {}, h('i', { class: 'c' }), 'Common'), h('span', {}, h('i', { class: 'u' }), 'Uncommon'), h('span', {}, h('i', { class: 'r' }), 'Rare')),
      this.foeEl,
    );
    // On a phone the tray sits under the pool, and this bar stays in reach.
    this.barCount = h('b', {}, '0');
    this.barInfo = h('div', { class: 'bar-info' });
    this.barLock = h('button', { class: 'btn btn-amber', onclick: () => this.lock() }, 'Lock in');
    this.bar = h('div', { class: 'draft-bar' }, h('div', { class: 'count' }, this.barCount, h('small', {}, ` / ${R.SIDE_DECK_SIZE}`)), this.barInfo, this.barLock);
    this.root.replaceChildren(
      h('div', { class: 'draft-head' }, h('h1', {}, 'Build your side deck'), h('p', {}, `Pick ${R.SIDE_DECK_SIZE} of these ${R.POOL_SIZE} cards. When both decks are locked in, four of your ten are dealt at random to your hand, and that hand has to last the whole match.`)),
      h('div', { class: 'draft-wrap' }, this.poolEl, this.tray),
      this.bar,
    );
  }

  info(c) {
    const r = R.rarityOf(c);
    this.infoEl.innerHTML = `<strong>${escapeHtml(R.label(c))}</strong> <span class="rarity ${r}">${RARITY_NAME[r]}</span><br>${escapeHtml(R.describe(c))}`;
    if (this.barInfo) this.barInfo.textContent = `${R.label(c)}: ${R.describe(c)}`;
  }

  toggle(id) {
    if (this.locked) return;
    const i = this.picked.indexOf(id);
    if (i >= 0) this.picked.splice(i, 1);
    else if (this.picked.length < R.SIDE_DECK_SIZE) {
      this.picked.push(id);
      const btn = this.poolEl.querySelector(`[data-id="${id}"]`);
      const card = this.pool.find((c) => c.id === id);
      // Fly a copy down to the tray.
      const target = this.slots[this.pool.filter((c) => this.picked.includes(c.id)).findIndex((c) => c.id === id)];
      if (btn && target && !fx.calm()) fx.fly(card, btn, target, { duration: 380, arc: 30 });
    } else {
      this.app.toast(`Your deck is full. Tap a chosen card to put it back.`);
      return;
    }
    sound.play('click', { vol: 0.7, rate: i >= 0 ? 0.85 : 1.05 });
    this.update();
  }

  suggest() {
    if (this.locked) return;
    // A balanced deck: rares and plus/minus first, then minus cards, then the best of the rest.
    const score = (c) => ({ tie: 100, double: 70, pm: 60 + (c.v >= 2 && c.v <= 4 ? 12 : 0), flip: 42, minus: 50 - Math.abs(c.v - 3.5) * 2, plus: 40 - c.v * 1.5 })[c.kind];
    const ranked = [...this.pool].sort((a, b) => score(b) - score(a));
    const out = [];
    let plus = 0;
    for (const c of ranked) {
      if (out.length >= R.SIDE_DECK_SIZE) break;
      if (c.kind === 'plus' && plus >= 3) continue;
      if (c.kind === 'plus') plus += 1;
      out.push(c.id);
    }
    for (const c of ranked) if (out.length < R.SIDE_DECK_SIZE && !out.includes(c.id)) out.push(c.id);
    this.picked = out;
    sound.play('play', { vol: 0.5 });
    this.update();
  }

  clear() {
    if (this.locked) return;
    this.picked = [];
    this.update();
  }

  lock() {
    if (this.picked.length !== R.SIDE_DECK_SIZE || this.locked) return;
    sound.play('play');
    this.app.send('lock', { ids: this.picked });
  }

  update() {
    const s = this.s;
    const m = s.match;
    const mine = m.players[s.you];
    if (mine.locked && mine.deck) this.picked = mine.deck.map((c) => c.id);
    const full = this.picked.length >= R.SIDE_DECK_SIZE;
    for (const btn of this.poolEl.querySelectorAll('.pick')) {
      const on = this.picked.includes(btn.dataset.id);
      btn.classList.toggle('on', on);
      btn.classList.toggle('full', full);
      btn.setAttribute('aria-pressed', String(on));
      btn.disabled = mine.locked;
    }
    // The tray shows the chosen cards in pool order.
    const chosen = this.pool.filter((c) => this.picked.includes(c.id));
    this.slots.forEach((slot, i) => {
      const c = chosen[i];
      if ((slot.dataset.id ?? '') === (c?.id ?? '')) return;
      slot.dataset.id = c?.id ?? '';
      slot.replaceChildren();
      if (c) {
        const el = cardEl(c);
        el.title = 'Put it back';
        el.addEventListener('click', () => this.toggle(c.id));
        slot.append(el);
      }
    });
    this.countEl.textContent = String(this.picked.length);
    this.barCount.textContent = String(this.picked.length);
    this.barLock.disabled = !full || mine.locked;
    this.barLock.textContent = mine.locked ? 'Locked' : 'Lock in';
    if (!this.barInfo.textContent || mine.locked) this.barInfo.textContent = mine.locked ? `Waiting for ${this.foeName}…` : full ? 'Ten chosen. Lock them in when you are happy.' : 'Tap cards to add them to your deck.';
    this.lockBtn.disabled = !full || mine.locked;
    this.lockBtn.textContent = mine.locked ? 'Locked in' : full ? 'Lock in my deck' : `Pick ${R.SIDE_DECK_SIZE - this.picked.length} more`;

    const foeId = m.order.find((id) => id !== s.you);
    const foeReady = m.players[foeId]?.locked;
    this.foeEl.className = `foe-status${foeReady ? ' ready' : ''}`;
    this.foeEl.replaceChildren(foeReady ? `${this.foeName} has locked in a deck.` : h('span', { class: 'spinner' }), foeReady ? '' : `${this.foeName} is choosing…`);

    let veil = this.tray.querySelector('.locked-veil');
    if (mine.locked && !veil) {
      this.tray.append(h('div', { class: 'locked-veil' }, h('strong', {}, 'Deck locked in'), h('span', { class: 'spinner' }), h('span', {}, `Waiting for ${this.foeName}`)));
    }
  }
}
