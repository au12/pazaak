// The room between matches: the two seats, who is watching, the clock
// setting, and the record of matches won at this table.

import { h, avatar } from './ui.js';

const LEVELS = [
  ['easy', 'Tobb'],
  ['normal', 'Vessa'],
  ['hard', 'Oru-Kaan'],
];
const LEVEL_NOTE = { easy: 'Computer, easy', normal: 'Computer, steady', hard: 'Computer, sharp' };
const CLOCKS = [
  [0, 'Off'],
  [20, '20s'],
  [30, '30s'],
  [45, '45s'],
  [60, '60s'],
];

export function renderLobby(root, s, app) {
  const me = s.you;
  const host = s.hostId === me;
  const seated = s.seats.includes(me);
  const live = s.match && s.match.phase !== 'over';
  const people = (id) => s.players.find((p) => p.id === id);

  const chair = (i) => {
    const pid = s.seats[i];
    const p = pid ? people(pid) : null;
    if (!p) {
      const actions = [];
      if (!seated && !live) actions.push(h('button', { class: 'btn btn-amber', onclick: () => app.send('sit', { seat: i }) }, 'Sit here'));
      if ((host || seated) && !live) {
        actions.push(
          h('div', { class: 'chair-note' }, 'Or play the computer'),
          h('div', { class: 'bot-picks' }, LEVELS.map(([lvl, name]) => h('button', { class: 'btn', title: LEVEL_NOTE[lvl], onclick: () => app.send('add-bot', { level: lvl, seat: i }) }, name))),
        );
      }
      return h(
        'div',
        { class: 'chair panel' },
        h('div', { class: 'avatar', html: '<svg viewBox="0 0 64 64"><path d="M32 2 L58 17 L58 47 L32 62 L6 47 L6 17Z" fill="none" stroke="#3b4651" stroke-width="2" stroke-dasharray="5 5"/></svg>' }),
        h('div', { class: 'chair-empty' }, 'Empty seat'),
        actions.length ? h('div', { class: 'chair-actions' }, actions) : null,
      );
    }
    const note = p.bot ? LEVEL_NOTE[p.level] : p.id === me ? 'You' : p.online ? 'Ready to play' : 'Away';
    const actions = [];
    if (p.id === me && !live) actions.push(h('button', { class: 'btn', onclick: () => app.send('leave-seat') }, 'Leave the seat'));
    else if (host && !live) actions.push(h('button', { class: 'btn', onclick: () => app.send('clear-seat', { seat: i }) }, p.bot ? 'Send the computer away' : 'Free this seat'));
    const wins = s.record[p.id] ?? 0;
    return h(
      'div',
      { class: 'chair panel' },
      h('div', { html: avatar(p) }).firstChild,
      h('div', {}, h('div', { class: 'chair-name' }, p.name), h('div', { class: 'chair-note' }, !p.bot ? h('span', { class: `online-dot${p.online ? '' : ' away'}` }) : null, note, wins ? `, ${wins} ${wins === 1 ? 'match' : 'matches'} won here` : '')),
      actions.length ? h('div', { class: 'chair-actions' }, actions) : null,
    );
  };

  const a = s.seats[0] ? s.record[s.seats[0]] ?? 0 : 0;
  const b = s.seats[1] ? s.record[s.seats[1]] ?? 0 : 0;
  const vs = h('div', { class: 'vs' }, a || b ? h('div', { class: 'record', title: 'Matches won at this table' }, `${a}–${b}`) : 'VS');

  const both = s.seats.every(Boolean);
  const actions = [];
  if (live) {
    actions.push(h('button', { class: 'btn btn-amber btn-big', onclick: () => app.backToMatch() }, 'Back to the match'));
  } else if (both && (host || seated)) {
    const over = s.match?.phase === 'over';
    if (over && seated) {
      const waiting = s.rematch.includes(me);
      actions.push(h('button', { class: 'btn btn-amber btn-big', disabled: waiting, onclick: () => app.send('rematch') }, waiting ? 'Waiting for the other player' : 'Rematch'));
    } else actions.push(h('button', { class: 'btn btn-amber btn-big', onclick: () => app.send('start') }, 'Start the match'));
  } else if (!both) {
    actions.push(h('p', { class: 'hint' }, seated ? 'Waiting for an opponent. Send the link, or pick a computer player.' : 'Take a seat to play.'));
  } else actions.push(h('p', { class: 'hint' }, 'Waiting for the players to start.'));

  const clock = h(
    'div',
    { class: 'seg', role: 'group', 'aria-label': 'Turn clock' },
    CLOCKS.map(([v, label]) => h('button', { 'aria-pressed': String(s.settings.clock === v), disabled: !host, onclick: () => app.send('settings', { clock: v }) }, label)),
  );
  const watchers = s.players.filter((p) => !p.bot && !s.seats.includes(p.id));

  const url = app.inviteUrl();
  const parts = [
    h(
      'div',
      { class: 'lobby-head' },
      h('h1', {}, s.code),
      h('p', {}, 'Send this link to whoever you want to play. The first two at the table take the seats; anyone after that can watch.'),
    ),
    h('div', { class: 'invite' }, h('code', {}, url), h('button', { class: 'btn', onclick: () => app.copyInvite() }, 'Copy link')),
    h('div', { class: 'chairs' }, chair(0), vs, chair(1)),
    h('div', { class: 'lobby-actions' }, actions),
    h('div', { class: 'lobby-settings' }, h('span', {}, 'Turn clock'), clock, host ? null : h('span', {}, 'The host sets this.')),
    watchers.length ? h('div', { class: 'watchers' }, `Watching: ${watchers.map((p) => p.name).join(', ')}`) : null,
  ];
  root.replaceChildren(...parts.filter(Boolean));
}
