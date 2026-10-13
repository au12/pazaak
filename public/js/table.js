// The table: two boards, the readouts, your hand, and everything that moves.
//
// The server sends the whole state each time. The table keeps its elements
// between updates (keyed by card id) so that a new card can fly in, a
// flipped card can turn over, and a set can be swept away, instead of the
// whole board being redrawn.

import * as R from './rules.js';
import { cardEl, faceSvg } from './cards.js';
import { h, avatar, escapeHtml } from './ui.js';
import { sound } from './sound.js';
import * as fx from './fx.js';

const EMOTE_TEXT = { pazaak: 'Pazaak!', gg: 'Good game', lucky: 'Lucky draw', ouch: 'Ouch', think: 'Hmm…', wow: 'Whoa' };
export { EMOTE_TEXT };

export class Table {
  constructor(root, app) {
    this.root = root;
    this.app = app;
    this.matchId = null;
    this.seen = 0;
    this.sel = null; // the hand card picked, { id }
    this.dom = null;
    this.clockTimer = setInterval(() => this.tickClock(), 250);
    document.addEventListener('keydown', (e) => this.key(e));
    document.addEventListener('pointerdown', (e) => {
      if (this.sel && !e.target.closest('.hand') && !e.target.closest('.status')) this.select(null);
    });
  }

  // ───────────────────────── building ─────────────────────────

  /** Who sits on the left (you, or the first seat when watching) and the right. */
  sidesOf(s) {
    const order = s.match.order;
    const meIn = order.includes(s.you);
    const left = meIn ? s.you : order[0];
    const right = order.find((p) => p !== left);
    return { left, right, meIn };
  }

  build(s) {
    const { left, right, meIn } = this.sidesOf(s);
    this.left = left;
    this.right = right;
    this.meIn = meIn;
    const side = (pid, cls) => {
      const cells = Array.from({ length: R.BOARD_SLOTS }, (_, i) => h('div', { class: 'cell', 'data-i': i }));
      const board = h('div', { class: 'board' }, cells);
      const readout = h('div', { class: 'readout' }, '0');
      const plate = h(
        'div',
        { class: 'plate', 'data-pid': pid },
        h('div', { class: 'face' }),
        h('div', { class: 'who' }, h('div', { class: 'who-name' }), h('div', { class: 'who-sub' }, h('div', { class: 'pips' }, [0, 1, 2].map(() => h('i', { class: 'pip' }))), h('div', { class: 'minihand' }))),
        readout,
      );
      const wrap = h('div', { class: `side ${cls}`, 'data-pid': pid }, plate, board);
      return { pid, wrap, plate, board, cells, readout, cards: new Map() };
    };
    const L = side(left, 'me');
    const Rr = side(right, 'them');
    const shoe = h('div', { class: 'shoe', title: 'Main deck' }, cardEl(null, { back: true }), cardEl(null, { back: true }), cardEl(null, { back: true }));
    const setNo = h('div', { class: 'set-no' });
    const spine = h('div', { class: 'spine' }, setNo, shoe);
    const arena = h('div', { class: 'arena' }, L.wrap, spine, Rr.wrap);
    const status = h('div', { class: 'status', role: 'status' });
    const hand = h('div', { class: 'hand' });
    const endBtn = h('button', { class: 'btn', onclick: () => this.endTurn() }, 'End turn');
    const standBtn = h('button', { class: 'btn btn-blue', onclick: () => this.stand() }, 'Stand');
    const dock = meIn
      ? h('div', { class: 'dock' }, h('div', { class: 'hand-wrap' }, hand, h('div', { class: 'hand-label' }, 'Your hand lasts the whole match')), h('div', { class: 'actions' }, endBtn, standBtn))
      : h('div', { class: 'spectating' }, 'You are watching this match. You can take a seat when it ends.');
    this.root.replaceChildren(arena, status, dock);
    this.dom = { sides: { [left]: L, [right]: Rr }, shoe, setNo, spine, status, hand, endBtn, standBtn };
    this.handKey = '';
  }

  // ───────────────────────── updating ─────────────────────────

  render(s) {
    const m = s.match;
    this.s = s;
    const fresh = this.matchId !== m.id || !this.dom || !m.order.includes(this.left) || !m.order.includes(this.right) || this.meIn !== m.order.includes(s.you);
    if (fresh) {
      this.matchId = m.id;
      this.seen = m.seq; // arriving mid-match: nothing to replay
      this.setNo = m.set?.no ?? 0;
      this.sel = null;
      this.build(s);
    }
    const events = m.events.filter((e) => e.n > this.seen);
    this.seen = m.seq;

    // A new set: sweep the old one off first.
    const setNo = m.set?.no ?? 0;
    if (setNo !== this.setNo) {
      this.sweepBoards();
      this.setNo = setNo;
    }

    for (const pid of [this.left, this.right]) this.renderSide(s, pid, events);
    this.renderSpine(s);
    if (this.meIn) this.renderHand(s, events);
    this.renderStatus(s);
    for (const e of events) this.effect(s, e);
  }

  player(pid) {
    return this.s.players.find((p) => p.id === pid);
  }
  nameOf(pid) {
    if (pid === this.s.you) return 'You';
    return this.player(pid)?.name ?? 'Opponent';
  }

  renderSide(s, pid, events) {
    const m = s.match;
    const d = this.dom.sides[pid];
    const p = this.player(pid);
    const mp = m.players[pid];
    const side = m.set?.sides?.[pid];
    const board = side?.board ?? [];

    // The plate.
    const face = d.plate.firstChild;
    const faceKey = `${p?.name}|${p?.bot}|${p?.level}`;
    if (face.dataset.key !== faceKey) {
      face.innerHTML = avatar(p);
      face.dataset.key = faceKey;
    }
    const nameEl = d.plate.querySelector('.who-name');
    const label = `${p?.name ?? 'Opponent'}${pid === s.you ? ' (you)' : ''}`;
    if (nameEl.textContent !== label) nameEl.textContent = label;
    const pips = d.plate.querySelectorAll('.pip');
    pips.forEach((pip, i) => pip.classList.toggle('lit', i < mp.wins));
    // Hand backs: for the other side always, for you on a phone where your hand is below anyway.
    const mini = d.plate.querySelector('.minihand');
    const miniKey = mp.hand.map((c) => (c.used ? 'u' : 'h')).join('');
    if (mini.dataset.key !== miniKey) {
      mini.replaceChildren(...mp.hand.map((c) => h('i', { class: c.used ? 'used' : '', 'data-id': c.id })));
      mini.dataset.key = miniKey;
    }
    mini.hidden = pid === s.you;
    let tag = d.plate.querySelector('.tag-stand');
    const standing = side?.standing && !m.set?.over;
    if (standing && !tag) d.plate.querySelector('.who-sub').append(h('span', { class: 'tag-stand' }, 'Standing'));
    if (!standing && tag) tag.remove();
    let off = d.plate.querySelector('.tag-bot');
    const offText = p && !p.bot && !p.online ? (p.autopilot ? 'Computer is playing for them' : 'Offline') : '';
    if (offText && !off) d.plate.querySelector('.who-sub').append((off = h('span', { class: 'tag-bot' })));
    if (off) {
      if (offText) off.textContent = offText;
      else off.remove();
    }

    // The readout.
    const t = side ? side.total : 0;
    const ro = d.readout;
    if (ro.dataset.v !== String(t)) {
      const from = Number(ro.dataset.v ?? 0);
      ro.dataset.v = String(t);
      this.count(ro, from, t);
      if (!fx.calm()) {
        ro.classList.remove('bump');
        void ro.offsetWidth;
        ro.classList.add('bump');
      }
    }
    ro.classList.toggle('over', t > R.TARGET);
    ro.classList.toggle('twenty', t === R.TARGET);
    ro.classList.toggle('near', t >= 17 && t < R.TARGET);

    // Whose turn.
    d.wrap.classList.toggle('active', m.phase === 'play' && m.set?.turn === pid);

    // The cards: keyed by id, so new ones can fly in and changed ones can turn.
    const arrivals = new Map();
    for (const e of events) if ((e.type === 'draw' || e.type === 'play') && e.pid === pid) arrivals.set(e.card.id, e);
    const keep = new Set(board.map((c) => c.id));
    for (const [id, el] of d.cards) {
      if (!keep.has(id)) {
        el.remove();
        d.cards.delete(id);
      }
    }
    board.forEach((c, i) => {
      const key = `${c.value}|${c.flipped}`;
      let el = d.cards.get(c.id);
      const doubled = board.some((x) => x.kind === 'double' && x.doubles === c.id);
      if (!el) {
        el = cardEl(c);
        el.dataset.key = key;
        d.cells[i].append(el);
        d.cards.set(c.id, el);
        const ev = arrivals.get(c.id);
        if (ev) this.arrive(el, c, ev, pid);
      } else if (el.dataset.key !== key) {
        el.dataset.key = key;
        const turnIt = !fx.calm();
        if (turnIt) {
          el.classList.remove('turning');
          void el.offsetWidth;
          el.classList.add('turning');
          setTimeout(() => (el.innerHTML = faceSvg(c)), 330);
        } else el.innerHTML = faceSvg(c);
      }
      if (el.parentElement !== d.cells[i]) d.cells[i].append(el);
      el.classList.toggle('doubled', doubled);
    });

    // The veil over a board: standing, bust, or the set's winner.
    let veil = d.board.querySelector('.board-veil');
    let want = null;
    if (side?.bust) want = 'bust';
    else if (m.set?.over && m.set.result?.winner === pid) want = m.set.result.reason === 'full' ? 'full' : 'win';
    else if (side?.standing) want = 'stand';
    if (!want && veil) veil.remove();
    if (want && veil?.dataset.kind !== want) {
      veil?.remove();
      const stampText = { bust: 'Bust', stand: `Stand ${t}`, full: 'Full board', win: '' }[want];
      veil = h('div', { class: `board-veil ${want === 'full' ? 'win' : want}`, 'data-kind': want }, stampText ? h('div', { class: `stamp ${want}` }, stampText) : null);
      d.board.append(veil);
    }
  }

  /** Rolls a readout from one total to the next, the way a counter would. */
  count(ro, from, to) {
    if (!ro.firstChild || ro.firstChild.nodeType !== 3) ro.prepend(document.createTextNode(''));
    const node = ro.firstChild;
    cancelAnimationFrame(ro._raf);
    if (fx.calm() || from === to || Math.abs(to - from) > 30) {
      node.nodeValue = String(to);
      return;
    }
    const start = performance.now();
    const dur = 380;
    const step = (now) => {
      const k = Math.min(1, (now - start) / dur);
      const e = 1 - (1 - k) ** 3;
      node.nodeValue = String(Math.round(from + (to - from) * e));
      if (k < 1) ro._raf = requestAnimationFrame(step);
    };
    ro._raf = requestAnimationFrame(step);
  }

  /** Flies a newly placed card in from wherever it came from. */
  arrive(el, card, ev, pid) {
    if (fx.calm()) return;
    el.style.visibility = 'hidden';
    let from;
    let turn = false;
    if (ev.type === 'draw') {
      from = this.dom.shoe.offsetWidth ? this.dom.shoe : this.dom.setNo;
      turn = true;
    } else if (pid === this.s.you) {
      from = this.dom.hand.querySelector(`[data-id="${card.id}"]`) ?? this.dom.hand;
    } else {
      from = this.dom.sides[pid].plate.querySelector(`.minihand [data-id="${card.id}"]`) ?? this.dom.sides[pid].plate;
      turn = true;
    }
    fx.fly({ ...card }, from, el, { turn, duration: ev.type === 'draw' ? 560 : 480 }).then(() => {
      el.style.visibility = '';
      el.classList.remove('landed');
      void el.offsetWidth;
      el.classList.add('landed');
    });
  }

  sweepBoards() {
    for (const pid of [this.left, this.right]) {
      const d = this.dom.sides[pid];
      const els = [...d.cards.values()];
      d.cards.clear();
      d.board.querySelector('.board-veil')?.remove();
      if (!els.length) continue;
      // Lift them out of the grid so the new set can start underneath.
      const ghosts = els.map((el) => {
        const r = el.getBoundingClientRect();
        el.remove();
        const g = el.cloneNode(true);
        Object.assign(g.style, { position: 'fixed', left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`, zIndex: 30, visibility: '' });
        document.body.append(g);
        return g;
      });
      fx.sweep(ghosts, pid === this.left ? -1 : 1).then(() => ghosts.forEach((g) => g.remove()));
    }
  }

  renderSpine(s) {
    const m = s.match;
    const no = m.set?.no ?? 0;
    const key = `${no}`;
    if (this.dom.setNo.dataset.key !== key) {
      this.dom.setNo.dataset.key = key;
      this.dom.setNo.innerHTML = no ? `Set<b>${no}</b>` : '';
    }
    this.app.setTopbar(no ? `Set ${no}, first to ${R.WINS_NEEDED} wins the match` : 'Dealing');
  }

  // ───────────────────────── your hand ─────────────────────────

  myTurn() {
    const m = this.s?.match;
    return Boolean(m && m.phase === 'play' && m.set && !m.set.over && m.set.turn === this.s.you);
  }

  canPlayCards() {
    const set = this.s.match.set;
    return this.myTurn() && !set.played && set.sides[this.s.you].board.length < R.BOARD_SLOTS;
  }

  renderHand(s) {
    const m = s.match;
    const mine = m.players[s.you];
    const live = this.canPlayCards();
    const key = mine.hand.map((c) => `${c.id}${c.used ? 'u' : ''}`).join(',');
    if (key !== this.handKey) {
      this.handKey = key;
      const slots = mine.hand.map((c, i) => {
        const slot = h('div', { class: 'hand-slot' });
        if (!c.used) {
          const btn = h('button', { class: 'hand-card', 'data-id': c.id, 'aria-label': `${R.label(c)}. ${R.describe(c)}`, title: R.describe(c), onclick: () => this.select(c.id) }, cardEl(c));
          btn.dataset.n = String(i + 1);
          slot.append(btn);
        }
        return slot;
      });
      this.dom.hand.replaceChildren(...slots);
      if (this.sel && !mine.hand.some((c) => c.id === this.sel && !c.used)) this.sel = null;
    }
    this.dom.hand.classList.toggle('live', live);
    this.dom.hand.classList.toggle('idle', !this.myTurn());
    for (const btn of this.dom.hand.querySelectorAll('.hand-card')) {
      const c = mine.hand.find((x) => x.id === btn.dataset.id);
      const outs = live ? R.outcomes(m.set.sides[s.you].board, c, m.set.mainId) : [];
      btn.disabled = !live || !outs.length;
      btn.classList.toggle('sel', this.sel === c.id);
    }
    if (!live) this.sel = null;
    this.renderChoices();

    // The buttons.
    const set = m.set;
    const mySide = set?.sides?.[s.you];
    const t = mySide?.total ?? 0;
    const turn = this.myTurn() && !mySide.standing;
    const over = turn && t > R.TARGET;
    const rescue = over && !set.played && mine.hand.some((c) => !c.used && R.outcomes(mySide.board, c, set.mainId).some((o) => o.total <= R.TARGET));
    this.dom.endBtn.disabled = !turn || (over && !rescue);
    this.dom.standBtn.disabled = !turn || over;
    this.dom.endBtn.textContent = over ? 'Bust' : 'End turn';
    this.dom.endBtn.classList.toggle('btn-red', over);
    this.dom.standBtn.textContent = turn ? `Stand on ${t}` : 'Stand';
    this.dom.endBtn.title = 'End your turn (E)';
    this.dom.standBtn.title = 'Stand on this total (S)';
    for (const b of [this.dom.endBtn, this.dom.standBtn]) b.classList.toggle('urgent', false);
  }

  select(id) {
    if (id && (!this.canPlayCards() || this.sel === id)) id = null;
    this.sel = id;
    for (const btn of this.dom.hand.querySelectorAll('.hand-card')) btn.classList.toggle('sel', btn.dataset.id === id);
    if (id) sound.play('click', { vol: 0.6 });
    this.renderChoices();
  }

  /** With a hand card picked, the status line turns into its choices: "Play +3 to 17". */
  renderChoices() {
    const status = this.dom.status;
    status.querySelector('.choices')?.remove();
    const ro = this.dom.sides[this.s.you]?.readout;
    ro?.querySelector('.ghost')?.remove();
    for (const el of status.children) if (!el.classList.contains('choices')) el.hidden = Boolean(this.sel);
    if (!this.sel) {
      status.classList.remove('choosing');
      return;
    }
    const m = this.s.match;
    const c = m.players[this.s.you].hand.find((x) => x.id === this.sel);
    const outs = R.outcomes(m.set.sides[this.s.you].board, c, m.set.mainId);
    const verb = c.kind === 'flip' ? 'Flip' : c.kind === 'double' ? 'Double' : 'Play';
    const buttons = outs.map((o) => {
      const face = R.needsSign(c) ? `${o.sign > 0 ? '+' : '−'}${c.v}${c.kind === 'tie' ? 'T' : ''}` : R.label(c);
      const cls = o.total > R.TARGET ? 'btn btn-red' : o.total === R.TARGET ? 'btn btn-amber' : 'btn';
      const what = c.kind === 'double' ? verb : `${verb} ${face}`;
      return h('button', { class: cls, onclick: () => this.play(c.id, o.sign) }, what, h('small', {}, `to ${o.total}`));
    });
    buttons.push(h('button', { class: 'btn btn-ghost', onclick: () => this.select(null), 'aria-label': 'Keep the card' }, 'Keep it'));
    status.classList.add('choosing');
    status.append(h('div', { class: 'choices' }, buttons));
  }

  play(id, sign) {
    this.sel = null;
    this.renderChoices();
    this.app.send('play', { id, sign });
  }
  endTurn() {
    if (this.dom.endBtn.disabled) return;
    this.app.send('end');
  }
  stand() {
    if (this.dom.standBtn.disabled) return;
    this.app.send('stand');
  }

  key(e) {
    if (!this.dom || !this.meIn || this.root.hidden || e.target.closest('input, textarea') || document.querySelector('.modal:not([hidden])')) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (/^[1-4]$/.test(k)) {
      const btn = this.dom.hand.querySelector(`.hand-card[data-n="${k}"]`);
      if (btn && !btn.disabled) this.select(btn.dataset.id);
    } else if (k === 'e') this.endTurn();
    else if (k === 's') this.stand();
    else if (k === 'escape') this.select(null);
  }

  // ───────────────────────── words ─────────────────────────

  renderStatus(s) {
    const m = s.match;
    const set = m.set;
    const me = s.you;
    const opp = this.meIn ? this.right : null;
    let html = '';
    if (m.phase === 'draft') html = 'Both players are choosing their side decks.';
    else if (m.phase === 'deal') html = 'Hands are dealt. Shuffling the main decks…';
    else if (m.phase === 'over') html = m.winner === me ? 'You won the match.' : `${escapeHtml(this.nameOf(m.winner))} won the match.`;
    else if (!set) html = '';
    else if (set.over) {
      const r = set.result;
      html = r.winner ? `${escapeHtml(this.nameOf(r.winner))} ${r.winner === me ? 'take' : 'takes'} set ${set.no}. Next set coming up…` : `Set ${set.no} is a draw. Next set coming up…`;
    } else if (set.turn === me) {
      const t = set.sides[me].total;
      const oppSide = set.sides[opp];
      const hand = m.players[me].hand;
      const rescue = !set.played && hand.some((c) => !c.used && R.outcomes(set.sides[me].board, c, set.mainId).some((o) => o.total <= R.TARGET));
      if (t > R.TARGET) html = rescue ? `Over 20 at <em>${t}</em>. Play a card to get back under, or bust.` : `Over 20 at <em>${t}</em>. Nothing in your hand can save this one.`;
      else if (oppSide?.standing) html = `Your turn. ${escapeHtml(this.player(opp)?.name ?? 'They')} stands on <em>${oppSide.total}</em>.`;
      else html = set.played ? 'Your turn. End it, or stand.' : 'Your turn. Play a card, end your turn, or stand.';
    } else if (set.turn) {
      const p = this.player(set.turn);
      if (p && !p.bot && !p.online && !p.autopilot) {
        html = `${escapeHtml(p.name)} has dropped out. <button class="link" data-autopilot="${p.id}">Let the computer play for them</button>`;
      } else html = `${escapeHtml(p?.name ?? 'Opponent')} ${p?.bot || p?.autopilot ? 'is thinking' : 'is playing'}…`;
    } else if (this.meIn && set.sides[me].standing) html = `You stand on <em>${set.sides[me].total}</em>.`;
    else html = '';
    const clock = set?.deadline && !set.over && set.turn ? '<span class="clock" data-clock></span>' : '';
    const full = html + clock;
    if (this.dom.status.dataset.html !== full) {
      this.dom.status.dataset.html = full;
      this.dom.status.querySelector('.status-text')?.remove();
      const text = h('span', { class: 'status-text', html: full });
      text.hidden = Boolean(this.sel);
      this.dom.status.prepend(text);
      this.dom.status.querySelector('[data-autopilot]')?.addEventListener('click', (e) => this.app.send('autopilot', { pid: e.target.dataset.autopilot }));
    }
    this.tickClock();
  }

  tickClock() {
    const el = this.dom?.status.querySelector('[data-clock]');
    const set = this.s?.match?.set;
    if (!el || !set?.deadline) return;
    const left = Math.max(0, Math.ceil((set.deadline - this.app.serverNow()) / 1000));
    el.textContent = `${left}s`;
    el.classList.toggle('low', left <= 5);
  }

  // ───────────────────────── moments ─────────────────────────

  effect(s, e) {
    const me = s.you;
    const mine = e.pid === me;
    const d = e.pid ? this.dom.sides[e.pid] : null;
    switch (e.type) {
      case 'draw':
        setTimeout(() => sound.play('draw', { rate: 0.96 + Math.random() * 0.08 }), 80);
        if (mine && this.lastTurnSound !== `${s.match.set?.no}:${e.n}`) {
          this.lastTurnSound = `${s.match.set?.no}:${e.n}`;
          sound.play('turn', { vol: 0.55 });
        }
        if (e.total > R.TARGET) {
          setTimeout(() => {
            sound.play('warn');
            fx.shake(d?.readout);
          }, 560);
        } else if (e.total === R.TARGET) setTimeout(() => fx.sparks(d?.readout, { color: '#FFD36B' }), 560);
        break;
      case 'play':
        setTimeout(() => sound.play('play'), 120);
        if (e.total === R.TARGET) setTimeout(() => fx.sparks(d?.readout, { color: '#FFD36B', count: 34 }), 500);
        else if (e.flipped?.length) setTimeout(() => fx.sparks(d?.board, { color: '#FFE9A6', count: 18, ring: false }), 450);
        break;
      case 'stand':
        sound.play('click', { rate: 0.8 });
        if (!e.auto) fx.sparks(d?.board, { color: '#6AA6FF', count: 14, speed: 160 });
        break;
      case 'bust':
        fx.shake(d?.board);
        fx.sparks(d?.readout, { color: '#FF5A60', count: 30 });
        break;
      case 'full':
        fx.sparks(d?.board, { color: '#FFD36B', count: 50, speed: 340 });
        break;
      case 'result':
        this.result(s, e);
        break;
      case 'timeout':
        this.app.toast(mine ? 'Your time ran out. Your turn was ended for you.' : `${this.nameOf(e.pid)} ran out of time.`);
        break;
      case 'forfeit':
        if (!mine) this.app.toast(`${this.nameOf(e.pid)} forfeited the match.`);
        break;
      default:
    }
  }

  result(s, e) {
    const me = s.you;
    const r = e;
    let kind = 'tie';
    let title = 'Set drawn';
    if (r.winner) {
      kind = this.meIn ? (r.winner === me ? 'win' : 'lose') : 'win';
      title = this.meIn ? (r.winner === me ? 'You take the set' : `${this.nameOf(r.winner)} takes the set`) : `${this.nameOf(r.winner)} takes the set`;
    }
    const totals = s.match.order.map((pid) => `${this.nameOf(pid)} ${r.totals[pid]}`).join(', ');
    const why = {
      bust: `${this.nameOf(s.match.order.find((p) => p !== r.winner))} went over 20.`,
      full: 'Nine cards on the board without going over.',
      tiebreaker: 'Level totals, settled by the tiebreaker.',
      higher: totals,
      tie: `Level on ${r.totals[s.match.order[0]]}. Nobody scores.`,
    }[r.reason];
    setTimeout(() => {
      if (kind === 'win') sound.play('winSet');
      else if (kind === 'lose') sound.play('loseSet');
      else sound.play('loseSet', { rate: 1.12, vol: 0.7 });
      if (r.winner) {
        const pips = this.dom.sides[r.winner]?.plate.querySelectorAll('.pip');
        const pip = pips?.[s.match.players[r.winner].wins - 1];
        if (pip) {
          pip.classList.remove('pop');
          void pip.offsetWidth;
          pip.classList.add('pop');
          fx.sparks(pip, { color: '#F3A73B', count: 22, speed: 200 });
        }
      }
      if (s.match.phase === 'over') return; // the match result says it all
      this.app.banner({ kind, title, text: why });
    }, 650);
  }
}
