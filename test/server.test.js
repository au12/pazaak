// The whole server over a real WebSocket: a person opens a table, plays the
// computer to the end of a match, and the room survives a save and reload.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pazaak-test-'));
Object.assign(process.env, { PAZAAK_NO_LISTEN: '1', PACE_SCALE: '0.01', BOT_DELAY_MS: '0', LOG_LEVEL: 'silent', DATA_DIR: dataDir, ADMIN_PASSWORD: 'letmein' });
const { server, rooms } = await import('../server/index.js');
const { Rooms } = await import('../server/rooms.js');
const { WebSocket } = await import('ws');
const R = await import('../public/js/rules.js');

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
after(() => {
  server.close();
  for (const room of rooms.rooms.values()) rooms.clearTimers(room);
  fs.rmSync(dataDir, { recursive: true, force: true });
  setTimeout(() => process.exit(0), 50).unref();
});

function client(code, name, token = `tok-${name}-${'x'.repeat(16)}`) {
  const ws = new WebSocket(`${base.replace('http', 'ws')}/ws`);
  const c = { ws, state: null, errors: [], waiters: [] };
  ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', room: code, token, name })));
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.t === 'state') c.state = msg.s;
    if (msg.t === 'err') c.errors.push(msg.m);
    for (const w of [...c.waiters]) if (w.test(c.state)) {
      c.waiters.splice(c.waiters.indexOf(w), 1);
      w.resolve(c.state);
    }
  });
  c.send = (a, data = {}) => ws.send(JSON.stringify({ t: 'a', a, ...data }));
  c.until = (fn, ms = 15000) =>
    c.state && fn(c.state)
      ? Promise.resolve(c.state)
      : new Promise((resolve, reject) => {
          const w = { test: (s) => s && fn(s), resolve };
          c.waiters.push(w);
          setTimeout(() => reject(new Error('timed out waiting')), ms).unref();
        });
  return c;
}

async function newRoom() {
  const res = await fetch(`${base}/api/rooms`, { method: 'POST', body: '{}' });
  assert.equal(res.status, 201);
  return (await res.json()).code;
}

test('a person plays the computer from side deck to the final set, then a rematch', async () => {
  const code = await newRoom();
  const a = client(code, 'Adam');
  await a.until((s) => s.seats.includes(s.you));
  a.send('add-bot', { level: 'normal', start: true });
  const draft = await a.until((s) => s.match?.phase === 'draft');
  const mine = draft.match.players[draft.you];
  assert.equal(mine.pool.length, 24);
  const foeId = draft.match.order.find((p) => p !== draft.you);
  assert.equal(draft.match.players[foeId].pool, null, 'the other pool stays hidden');

  a.send('lock', { ids: mine.pool.slice(0, 10).map((c) => c.id) });
  await a.until((s) => s.match.phase === 'play' || s.match.phase === 'deal');
  const dealt = a.state.match.players;
  assert.equal(dealt[a.state.you].hand.length, 4);
  assert.ok(dealt[foeId].hand.every((c) => c.hidden && !c.kind), 'opponent hand is backs only');

  // Play it out: save yourself if you can, stand on 18 or more.
  let moves = 0;
  while (a.state.match.phase !== 'over' && moves < 400) {
    const s = await a.until((x) => x.match.phase === 'over' || (x.match.set && x.match.set.turn === x.you && !x.match.set.over));
    if (s.match.phase === 'over') break;
    const set = s.match.set;
    const me = set.sides[s.you];
    const turnKey = `${set.no}:${set.turnNo}:${set.played}`;
    if (me.total > 20 && !set.played) {
      const card = s.match.players[s.you].hand.find((c) => !c.used && R.outcomes(me.board, c, set.mainId).some((o) => o.total <= 20));
      if (card) {
        const o = R.outcomes(me.board, card, set.mainId).filter((x) => x.total <= 20).sort((x, y) => y.total - x.total)[0];
        a.send('play', { id: card.id, sign: o.sign });
      } else a.send('end');
    } else if (me.total > 20) a.send('end');
    else a.send(me.total >= 18 ? 'stand' : 'end');
    moves += 1;
    await a.until((x) => x.match.phase === 'over' || !x.match.set || `${x.match.set.no}:${x.match.set.turnNo}:${x.match.set.played}` !== turnKey || x.match.set.turn !== x.you);
  }
  const over = await a.until((s) => s.match.phase === 'over', 30000);
  const wins = Object.values(over.match.players).map((p) => p.wins);
  assert.ok(wins.includes(3));
  assert.equal(over.record[over.match.winner], 1);
  // At the end the computer's unplayed cards are shown.
  assert.ok(over.match.players[foeId].hand.every((c) => c.used || c.kind));
  assert.deepEqual(a.errors, []);

  a.send('rematch');
  await a.until((s) => s.match.phase === 'draft' && s.match.id !== over.match.id);
  a.ws.close();
});

test('two people at one table: seats, watchers, and turns that are not yours', async () => {
  const code = await newRoom();
  const a = client(code, 'Ana');
  await a.until((s) => s.seats[0]);
  const b = client(code, 'Ben');
  await b.until((s) => s.seats.every(Boolean));
  const c = client(code, 'Cy');
  const watching = await c.until((s) => s.players.length === 3);
  assert.ok(!watching.seats.includes(watching.you), 'the third person watches');

  c.send('start');
  await new Promise((r) => setTimeout(r, 100));
  assert.match(c.errors.at(-1), /host or a seated player/);

  a.send('settings', { clock: 30 });
  b.send('settings', { clock: 60 });
  await new Promise((r) => setTimeout(r, 100));
  assert.match(b.errors.at(-1), /Only the host/);
  assert.equal(a.state.settings.clock, 30);

  a.send('start');
  const sa = await a.until((s) => s.match?.phase === 'draft');
  const sb = await b.until((s) => s.match?.phase === 'draft');
  a.send('lock', { ids: sa.match.players[sa.you].pool.slice(0, 10).map((x) => x.id) });
  b.send('lock', { ids: sb.match.players[sb.you].pool.slice(5, 15).map((x) => x.id) });
  const play = await a.until((s) => s.match.set && s.match.set.turn);
  const onTurn = play.match.set.turn === a.state.you ? a : b;
  const off = onTurn === a ? b : a;
  off.send('stand');
  await new Promise((r) => setTimeout(r, 100));
  assert.match(off.errors.at(-1), /not your turn/);
  assert.ok(play.match.set.deadline > play.now, 'the turn clock is running');
  // The watcher sees neither hand.
  const cw = await c.until((s) => s.match?.phase === 'play');
  for (const pid of cw.match.order) assert.ok(cw.match.players[pid].hand.every((x) => x.hidden));
  for (const x of [a, b, c]) x.ws.close();
});

test('rooms are saved and come back after a restart, mid-match', async () => {
  const code = await newRoom();
  const a = client(code, 'Dee');
  await a.until((s) => s.seats.includes(s.you));
  a.send('add-bot', { level: 'easy', start: true });
  const d = await a.until((s) => s.match?.phase === 'draft');
  a.send('lock', { ids: d.match.players[d.you].pool.slice(0, 10).map((x) => x.id) });
  const live = await a.until((s) => s.match.set && s.match.set.turn === s.you);
  rooms.save();
  const again = new Rooms();
  again.load();
  const back = again.get(code);
  assert.ok(back, 'the room is back');
  assert.equal(back.match.id, live.match.id);
  assert.equal(back.match.set.turn, live.you);
  assert.equal(back.players.get(live.you).name, 'Dee');
  for (const room of again.rooms.values()) again.clearTimers(room);
  a.ws.close();
});

test('the admin page needs its password', async () => {
  assert.equal((await fetch(`${base}/admin/api/rooms`)).status, 401);
  const bad = await fetch(`${base}/admin/api/login`, { method: 'POST', body: JSON.stringify({ password: 'nope' }) });
  assert.equal(bad.status, 403);
  const ok = await fetch(`${base}/admin/api/login`, { method: 'POST', body: JSON.stringify({ password: 'letmein' }) });
  assert.equal(ok.status, 200);
  const cookie = ok.headers.get('set-cookie').split(';')[0];
  const list = await (await fetch(`${base}/admin/api/rooms`, { headers: { cookie } })).json();
  assert.ok(list.rooms.length >= 3);
  const code = list.rooms[0].code;
  assert.equal((await fetch(`${base}/admin/api/rooms/${code}/delete`, { method: 'POST', headers: { cookie } })).status, 200);
  assert.equal((await fetch(`${base}/api/rooms/${code}`)).status, 404);
});

test('media can be fetched in ranges, so the video seeks', async () => {
  const res = await fetch(`${base}/media/tutorial.mp4`, { headers: { range: 'bytes=0-99' } });
  assert.equal(res.status, 206);
  assert.equal((await res.arrayBuffer()).byteLength, 100);
  assert.match(res.headers.get('content-range'), /^bytes 0-99\//);
});

test('when a player drops out, the computer can finish their turns', async () => {
  const code = await newRoom();
  const a = client(code, 'Eve');
  await a.until((s) => s.seats[0]);
  const b = client(code, 'Fox');
  await b.until((s) => s.seats.every(Boolean));
  a.send('start');
  const sa = await a.until((s) => s.match?.phase === 'draft');
  const sb = await b.until((s) => s.match?.phase === 'draft');
  a.send('lock', { ids: sa.match.players[sa.you].pool.slice(0, 10).map((x) => x.id) });
  b.send('lock', { ids: sb.match.players[sb.you].pool.slice(0, 10).map((x) => x.id) });
  await a.until((s) => s.match.set?.turn);
  const fox = sb.you;
  b.ws.close();
  await a.until((s) => !s.players.find((p) => p.id === fox).online);
  a.send('autopilot', { pid: fox });
  await a.until((s) => s.players.find((p) => p.id === fox).autopilot);
  // Eve just ends every turn; Fox's seat keeps playing without him.
  const seen = new Set();
  while (a.state.match.phase !== 'over' && seen.size < 6) {
    const s = await a.until((x) => x.match.phase === 'over' || x.match.set?.turn === x.you || x.match.set?.turn === fox, 20000);
    if (s.match.set?.turn === fox) seen.add(`${s.match.set.no}:${s.match.set.turnNo}`);
    if (s.match.set?.turn === s.you) {
      const key = s.match.set.turnNo;
      a.send(s.match.set.sides[s.you].total >= 17 ? 'stand' : 'end');
      await a.until((x) => x.match.phase === 'over' || x.match.set?.turnNo !== key || x.match.set?.turn !== x.you);
    } else await new Promise((r) => setTimeout(r, 20));
  }
  assert.ok(seen.size >= 2 || a.state.match.phase === 'over', 'the computer took turns for Fox');
  a.ws.close();
});
