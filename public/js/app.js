// The app: the start screen, joining a room, and deciding which view of the
// room to show (seats, side deck, table) as the server's state comes in.

import { Connection } from './net.js';
import { cardEl } from './cards.js';
import { h, toast, copy, rivalFace, openModal } from './ui.js';
import { sound, store } from './sound.js';
import { starfield, cardShower, sparks } from './fx.js';
import { setupGuide } from './guide.js';
import { renderLobby } from './lobby.js';
import { Draft } from './draft.js';
import { Table, EMOTE_TEXT } from './table.js';
import * as R from './rules.js';

const CONFIG = JSON.parse(document.getElementById('config').textContent || '{}');
const $ = (id) => document.getElementById(id);

function token() {
  let t = store.get('token', '');
  if (typeof t !== 'string' || t.length < 16) {
    const bytes = crypto.getRandomValues(new Uint8Array(18));
    t = btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, (c) => ({ '+': '-', '/': '_', '=': '' })[c]);
    store.set('token', t);
  }
  return t;
}

const base = new URL(document.baseURI).pathname;
const roomFromPath = () => {
  const rest = location.pathname.startsWith(base) ? location.pathname.slice(base.length) : location.pathname;
  const m = /^r\/([^/]+)\/?$/.exec(rest);
  return m ? decodeURIComponent(m[1]) : null;
};

class App {
  constructor() {
    this.conn = null;
    this.state = null;
    this.skew = 0;
    this.chat = [];
    this.unread = 0;
    this.table = new Table($('table'), this);
    this.draft = new Draft($('draft'), this);
    this.dismissed = null;
    this.forceLobby = false;
    this.toast = toast;
    this.setupHome();
    this.setupRoomChrome();
    this.setupSettings();
    setupGuide();
    starfield($('stars'));
    if (store.get('calm', false)) document.body.classList.add('calm');
    window.addEventListener('popstate', () => this.route());
    this.route();
  }

  route() {
    const code = roomFromPath();
    if (code) this.enterRoom(code);
    else this.showHome();
  }

  go(path) {
    history.pushState({}, '', new URL(path, document.baseURI));
    this.route();
  }

  // ───────────────────────── home ─────────────────────────

  setupHome() {
    const nameInput = $('home-name');
    nameInput.value = store.get('name', '');
    nameInput.addEventListener('change', () => store.set('name', nameInput.value.trim()));

    // The logo's hand of cards.
    const fan = $('logo-fan');
    const cards = [
      { kind: 'plus', v: 4 },
      { kind: 'main', v: 10, value: 10, src: 'main' },
      { kind: 'pm', v: 3 },
      { kind: 'minus', v: 2 },
      { kind: 'tie', v: 1 },
    ];
    cards.forEach((c, i) => {
      const el = cardEl(c);
      el.style.setProperty('--i', i - 2);
      fan.append(el);
    });

    for (const face of document.querySelectorAll('.rival-face')) face.innerHTML = rivalFace(face.dataset.level);
    $('rivals').addEventListener('click', (e) => {
      const b = e.target.closest('.rival');
      if (b) this.newRoom({ vs: b.dataset.level });
    });
    $('create-room').addEventListener('click', () => this.newRoom({}));
    $('join-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const raw = $('join-code').value.trim();
      const code = (/\/r\/([^/?#]+)/.exec(raw)?.[1] ?? raw).toLowerCase().replace(/\s+/g, '-');
      if (!code) return toast('Type the table code, or paste the link you were sent.');
      if (!this.needName()) return;
      this.go(`r/${encodeURIComponent(code)}`);
    });
    if (CONFIG.needsPassword) $('create-password').hidden = false;
  }

  needName() {
    const name = $('home-name').value.trim() || store.get('name', '');
    if (!name) {
      toast('Put your name in first, so the table knows who you are.', { error: true });
      $('home-name').focus();
      return false;
    }
    store.set('name', name);
    return true;
  }

  async newRoom({ vs = null }) {
    if (!this.needName()) return;
    sound.play('click');
    try {
      const res = await fetch('api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: $('create-password').value }) });
      const body = await res.json();
      if (!res.ok) return toast(body.error ?? 'Could not open a table.', { error: true });
      this.pendingBot = vs;
      this.go(`r/${body.code}`);
    } catch {
      toast('Could not reach the server.', { error: true });
    }
  }

  showHome() {
    this.leave();
    document.title = CONFIG.siteName ?? 'Pazaak';
    $('room').hidden = true;
    $('home').hidden = false;
  }

  // ───────────────────────── a room ─────────────────────────

  enterRoom(code) {
    const name = store.get('name', '');
    if (!name) return this.askName(code);
    this.leave();
    $('home').hidden = true;
    $('room').hidden = false;
    for (const v of ['lobby', 'draft', 'table']) $(v).hidden = true;
    this.code = code;
    $('room-code-text').textContent = code;
    document.title = `${code} | ${CONFIG.siteName ?? 'Pazaak'}`;
    this.chat = [];
    this.renderChat();
    this.conn = new Connection({
      room: code,
      token: token(),
      name,
      onState: (s) => this.onState(s),
      onError: (m) => toast(m, { error: true }),
      onFatal: (c, m) => {
        toast(m, { error: true });
        this.go('');
      },
      onStatus: (ok) => ($('conn').hidden = ok),
      onChat: (msg) => this.onChat(msg),
    });
  }

  askName(code) {
    $('home').hidden = false;
    $('room').hidden = true;
    const input = h('input', { maxlength: 18, placeholder: 'What the table calls you', autocomplete: 'nickname' });
    const go = () => {
      const v = input.value.trim();
      if (!v) return input.focus();
      store.set('name', v);
      $('home-name').value = v;
      curtain.remove();
      this.enterRoom(code);
    };
    input.addEventListener('keydown', (e) => e.key === 'Enter' && go());
    const curtain = h(
      'div',
      { class: 'curtain' },
      h('div', { class: 'result panel' }, h('h2', { style: { fontSize: '22px' } }, 'Join the table'), h('p', {}, `You have been invited to ${code}. What should the table call you?`), h('label', { class: 'field', style: { width: '100%' } }, input), h('div', { class: 'result-buttons' }, h('button', { class: 'btn', onclick: () => (curtain.remove(), this.go('')) }, 'Cancel'), h('button', { class: 'btn btn-amber', onclick: go }, 'Join'))),
    );
    document.body.append(curtain);
    input.focus();
  }

  leave() {
    this.conn?.close();
    this.conn = null;
    this.state = null;
    this.table.matchId = null;
    this.draft.matchId = null;
    this.curtain?.remove();
    this.curtain = null;
    this.dealing?.remove();
    $('chat').hidden = true;
  }

  send(action, data) {
    if (!this.conn?.send(action, data)) toast('Not connected. Trying again…', { error: true });
  }

  serverNow() {
    return Date.now() + this.skew;
  }

  inviteUrl() {
    return new URL(`r/${this.state?.code ?? this.code}`, document.baseURI).href;
  }

  async copyInvite() {
    if (await copy(this.inviteUrl())) toast('Invite link copied.');
  }

  onState(s) {
    const first = !this.state;
    this.state = s;
    this.skew = s.now - Date.now();
    if (s.code !== this.code) {
      this.code = s.code;
      history.replaceState({}, '', new URL(`r/${s.code}`, document.baseURI));
    }
    // Practice against the computer: fill the other seat and start.
    if (first && this.pendingBot) {
      const lvl = this.pendingBot;
      this.pendingBot = null;
      if (s.seats.includes(s.you) && s.seats.includes(null) && !s.match) this.send('add-bot', { level: lvl, start: true });
    }
    this.renderRoom();
  }

  view() {
    const s = this.state;
    const m = s.match;
    if (!m) return 'lobby';
    if (m.phase === 'draft') return m.order.includes(s.you) ? 'draft' : 'table';
    if (m.phase === 'over') return this.dismissed === m.id ? 'lobby' : 'table';
    return this.forceLobby ? 'lobby' : 'table';
  }

  renderRoom() {
    const s = this.state;
    if (!s) return;
    const view = this.view();
    for (const v of ['lobby', 'draft', 'table']) $(v).hidden = v !== view;
    const m = s.match;
    const playing = m && m.phase !== 'over' && m.order.includes(s.you);
    $('menu-forfeit').hidden = !playing;
    $('menu-lobby').textContent = view === 'lobby' && playing ? 'Back to the match' : 'Table and seats';

    if (view === 'lobby') {
      renderLobby($('lobby'), s, this);
      this.setTopbar(m && m.phase !== 'over' ? 'A match is being played' : 'Waiting at the table');
    } else if (view === 'draft') {
      this.draft.render(s);
      this.setTopbar('Choosing side decks');
    } else {
      this.table.render(s);
      if (m.phase === 'draft') this.setTopbar('The players are choosing their side decks');
    }

    // The deal: your four hand cards, once per match.
    if (m && m.phase === 'deal' && this.dealt !== m.id && view === 'table') {
      this.dealt = m.id;
      this.showDeal(s);
    }
    // The end of a match.
    if (this.curtain && this.curtain.dataset.match !== m?.id) {
      this.curtain.remove();
      this.curtain = null;
    }
    if (m && m.phase === 'over' && view === 'table' && this.resulted !== m.id) {
      this.resulted = m.id;
      const delay = m.events.some((e) => e.type === 'match' && e.n > (this.lastSeq ?? 0)) ? 1700 : 0;
      setTimeout(() => this.showResult(), delay);
    } else if (this.curtain && m?.phase === 'over') this.updateResultButtons();
    this.lastSeq = m?.seq ?? 0;
  }

  setTopbar(text) {
    const el = $('topbar-mid');
    if (el.textContent !== text) el.textContent = text;
  }

  backToMatch() {
    this.forceLobby = false;
    this.renderRoom();
  }

  showDeal(s) {
    const m = s.match;
    const mine = m.players[s.you];
    if (!mine) return;
    sound.play('play', { vol: 0.8 });
    const row = h('div', { class: 'deal-row' }, mine.hand.map((c, i) => {
      const el = cardEl(c);
      el.style.setProperty('--n', i);
      return el;
    }));
    const el = h('div', { class: 'dealing' }, h('h2', {}, 'Your hand for this match'), row, h('p', {}, 'Four cards from your side deck. Spend them wisely: they have to last until someone wins three sets.'));
    this.dealing?.remove();
    this.dealing = el;
    document.body.append(el);
    mine.hand.forEach((_, i) => setTimeout(() => sound.play('draw', { rate: 1 + i * 0.05, vol: 0.7 }), 400 + i * 220));
    setTimeout(() => el.classList.add('out'), 2900);
    setTimeout(() => el.remove(), 3300);
  }

  showResult() {
    const s = this.state;
    const m = s?.match;
    if (!m || m.phase !== 'over' || this.view() !== 'table') return;
    const me = s.you;
    const playing = m.order.includes(me);
    const name = (pid) => s.players.find((p) => p.id === pid)?.name ?? 'Opponent';
    const won = m.winner === me;
    const kind = playing ? (won ? 'win' : 'lose') : 'win';
    const title = playing ? (won ? 'Victory' : 'Defeat') : `${name(m.winner)} wins`;
    const loser = m.order.find((p) => p !== m.winner);
    const text =
      m.reason === 'forfeit'
        ? playing && !won
          ? 'You forfeited the match.'
          : `${name(loser)} forfeited the match.`
        : `${playing ? (won ? 'You' : name(m.winner)) : name(m.winner)} won ${m.players[m.winner].wins} sets to ${m.players[loser].wins}.`;
    if (playing) sound.play(won ? 'winMatch' : 'loseMatch');
    if (won || !playing) cardShower();

    // Each set from your side first: "Set 2: you 19, Vessa 23".
    const first = playing ? me : m.order[0];
    const sides = [first, m.order.find((p) => p !== first)];
    const sets = h('div', { class: 'result-sets' }, m.history.map((x) => h('span', { class: x.winner === me ? 'w' : '', title: x.winner ? `${x.winner === me ? 'You' : name(x.winner)} took this set` : 'A draw' }, `Set ${x.no}: ${sides.map((p) => `${p === me ? 'you' : name(p)} ${x.totals[p]}${x.winner === p ? ' ✓' : ''}`).join(', ')}${x.winner ? '' : ', drawn'}`)));
    const hands = h(
      'div',
      { class: 'result-hands' },
      m.order.map((pid) =>
        h('div', {}, `${pid === me ? 'Your' : `${name(pid)}’s`} unplayed cards`, h('div', { class: 'row' }, m.players[pid].hand.filter((c) => !c.used && !c.hidden).map((c) => cardEl(c))), m.players[pid].hand.every((c) => c.used) ? 'All four played' : null),
      ),
    );
    this.resultButtons = h('div', { class: 'result-buttons' });
    const box = h('div', { class: `result panel ${kind}` }, h('h2', {}, title), h('p', {}, text), sets, hands, this.resultButtons);
    const curtain = h('div', { class: 'curtain', 'data-match': m.id }, box);
    this.curtain?.remove();
    this.curtain = curtain;
    document.body.append(curtain);
    this.updateResultButtons();
    if (won) setTimeout(() => sparks(box.querySelector('h2'), { color: '#FFD36B', count: 60, speed: 380 }), 300);
  }

  updateResultButtons() {
    const s = this.state;
    const m = s.match;
    const seated = s.seats.includes(s.you) && m.order.includes(s.you);
    const waiting = s.rematch.includes(s.you);
    const other = m.order.find((p) => p !== s.you);
    const theyWant = s.rematch.includes(other);
    const buttons = [h('button', { class: 'btn', onclick: () => this.dismissResult() }, 'Back to the table')];
    if (seated && s.seats.every(Boolean)) {
      buttons.push(h('button', { class: 'btn btn-amber', disabled: waiting, onclick: () => this.send('rematch') }, waiting ? 'Waiting for them…' : theyWant ? 'Accept the rematch' : 'Rematch'));
    }
    this.resultButtons.replaceChildren(...buttons);
  }

  dismissResult() {
    this.dismissed = this.state.match.id;
    this.curtain?.remove();
    this.curtain = null;
    this.renderRoom();
  }

  banner({ kind, title, text }) {
    this.bannerEl?.remove();
    const el = h('div', { class: `banner ${kind}`, role: 'status' }, h('h2', {}, title), text ? h('p', {}, text) : null);
    this.bannerEl = el;
    document.body.append(el);
    setTimeout(() => el.classList.add('out'), 2900);
    setTimeout(() => el.remove(), 3300);
  }

  confirm({ title, text, ok, danger = false }) {
    return new Promise((resolve) => {
      const done = (v) => {
        c.remove();
        resolve(v);
      };
      const c = h(
        'div',
        { class: 'curtain', onclick: (e) => e.target === c && done(false) },
        h('div', { class: 'result panel' }, h('h2', { style: { fontSize: '22px' } }, title), h('p', {}, text), h('div', { class: 'result-buttons' }, h('button', { class: 'btn', onclick: () => done(false) }, 'Cancel'), h('button', { class: `btn ${danger ? 'btn-red' : 'btn-amber'}`, onclick: () => done(true) }, ok))),
      );
      document.body.append(c);
    });
  }

  // ───────────────────────── chrome: top bar, menu, chat ─────────────────────────

  setupRoomChrome() {
    $('leave-room').addEventListener('click', () => this.go(''));
    $('room-code').addEventListener('click', () => this.copyInvite());
    const menu = $('menu');
    $('menu-toggle').addEventListener('click', (e) => {
      e.stopPropagation();
      menu.hidden = !menu.hidden;
    });
    document.addEventListener('click', (e) => {
      if (!menu.hidden && !e.target.closest('#menu')) menu.hidden = true;
    });
    $('menu-lobby').addEventListener('click', () => {
      menu.hidden = true;
      const m = this.state?.match;
      if (m && m.phase === 'over') this.dismissResult();
      else {
        this.forceLobby = !this.forceLobby;
        this.renderRoom();
      }
    });
    $('menu-forfeit').addEventListener('click', async () => {
      menu.hidden = true;
      const yes = await this.confirm({ title: 'Forfeit the match?', text: 'Your opponent wins the match straight away.', ok: 'Forfeit', danger: true });
      if (yes) this.send('forfeit');
    });

    const music = $('music-toggle');
    const syncMusic = () => {
      music.classList.toggle('off', !sound.musicOn);
      music.title = sound.musicOn ? 'Music on' : 'Music off';
    };
    music.addEventListener('click', () => sound.setMusicOn(!sound.musicOn));
    sound.onChange(syncMusic);
    syncMusic();

    // Chat and emotes.
    $('chat-toggle').addEventListener('click', () => this.toggleChat());
    $('chat-close').addEventListener('click', () => this.toggleChat(false));
    $('emotes').append(...Object.entries(EMOTE_TEXT).map(([k, label]) => h('button', { onclick: () => this.send('say', { emote: k }) }, label)));
    $('chat-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const v = $('chat-input').value.trim();
      if (!v) return;
      this.send('say', { text: v });
      $('chat-input').value = '';
    });
  }

  toggleChat(open = $('chat').hidden) {
    $('chat').hidden = !open;
    if (open) {
      this.unread = 0;
      $('chat-dot').hidden = true;
      const log = $('chat-log');
      log.scrollTop = log.scrollHeight;
    }
  }

  onChat(msg) {
    if (msg.all) {
      this.chat = msg.all;
      this.renderChat();
      return;
    }
    const line = msg.m;
    this.chat.push(line);
    this.renderChat();
    if ($('chat').hidden && line.by !== this.state?.you) {
      this.unread += 1;
      $('chat-dot').hidden = false;
    }
    this.bubble(line);
    if (line.by !== this.state?.you) sound.play('click', { rate: 1.3, vol: 0.6 });
  }

  bubble(line) {
    const plate = document.querySelector(`#table:not([hidden]) .plate[data-pid="${line.by}"]`);
    const text = line.emote ? EMOTE_TEXT[line.emote] : line.text;
    if (plate) {
      plate.querySelector('.emote-bubble')?.remove();
      const b = h('div', { class: 'emote-bubble' }, text.length > 60 ? `${text.slice(0, 58)}…` : text);
      plate.append(b);
      setTimeout(() => b.remove(), 3300);
    } else if (line.by !== this.state?.you && $('chat').hidden) toast(`${line.name}: ${text}`);
  }

  renderChat() {
    const log = $('chat-log');
    if (!this.chat.length) {
      log.replaceChildren(h('li', { class: 'empty' }, 'Nothing said yet. The buttons above send a quick word.'));
      return;
    }
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    log.replaceChildren(...this.chat.map((l) => (l.emote ? h('li', { class: 'emote' }, h('b', {}, l.name), EMOTE_TEXT[l.emote]) : h('li', {}, h('b', {}, l.name), l.text))));
    if (atBottom) log.scrollTop = log.scrollHeight;
  }

  // ───────────────────────── settings ─────────────────────────

  setupSettings() {
    const modal = $('settings');
    const music = $('vol-music');
    const sfx = $('vol-sfx');
    const calm = $('pref-motion');
    const name = $('settings-name');
    const now = $('now-playing');
    modal.addEventListener('open', () => {
      music.value = String(Math.round((sound.musicOn ? sound.musicVolume : 0) * 100));
      sfx.value = String(Math.round(sound.sfxVolume * 100));
      calm.checked = document.body.classList.contains('calm');
      name.value = store.get('name', '');
      now.textContent = sound.musicOn && sound.unlocked ? `Now playing: ${sound.track.title}` : '';
    });
    music.addEventListener('input', () => {
      sound.setMusicVolume(Number(music.value) / 100);
      now.textContent = sound.musicOn ? `Now playing: ${sound.track.title}` : '';
    });
    sfx.addEventListener('input', () => sound.setSfx(Number(sfx.value) / 100));
    sfx.addEventListener('change', () => sound.play('draw'));
    calm.addEventListener('change', () => {
      document.body.classList.toggle('calm', calm.checked);
      store.set('calm', calm.checked);
    });
    name.addEventListener('change', () => {
      const v = name.value.trim();
      if (!v) return;
      store.set('name', v);
      $('home-name').value = v;
      if (this.conn) this.send('name', { name: v });
    });
  }
}

window.pazaak = new App();
export { R };
