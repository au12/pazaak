// The au12 Arcade: what the server allows with ARCADE_URL set and without,
// and what the page reports to the arcade.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const servers = [];
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pazaak-arcade-'));
after(() => {
  servers.forEach((s) => s.kill());
  fs.rmSync(dataDir, { recursive: true, force: true });
});

async function boot(env) {
  const port = 43000 + Math.floor(Math.random() * 900) + servers.length * 1000;
  const server = spawn(process.execPath, ['server/index.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', PERSIST: 'false', LOG_LEVEL: 'silent', DATA_DIR: dataDir, ...env },
    stdio: 'inherit',
  });
  servers.push(server);
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`${base}/healthz`)).ok) return base;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not start');
}

test('without ARCADE_URL nothing changes', async () => {
  const base = await boot({});
  const page = await fetch(`${base}/`);
  assert.equal(page.headers.get('x-frame-options'), 'SAMEORIGIN');
  assert.doesNotMatch(page.headers.get('content-security-policy'), /frame-ancestors/);
  assert.equal((await fetch(`${base}/arcade.json`)).status, 404);
});

test('with ARCADE_URL the arcade may frame the game and hear from it', async () => {
  const base = await boot({ ARCADE_URL: 'https://arcade.example.com', ADMIN_PASSWORD: 'correct horse battery' });
  const page = await fetch(`${base}/r/spice-run-77`);
  const csp = page.headers.get('content-security-policy');
  assert.equal(page.headers.get('x-frame-options'), null);
  assert.match(csp, /frame-ancestors 'self' https:\/\/arcade\.example\.com(;|$)/);
  assert.match(csp, /connect-src 'self' ws: wss: https:\/\/arcade\.example\.com;/);
  assert.match(await page.text(), /<script src="js\/vendor\/arcade\.js" data-game="pazaak" data-config="\/arcade\.json"><\/script>/);
  assert.deepEqual(await (await fetch(`${base}/arcade.json`)).json(), { url: 'https://arcade.example.com' });
  const admin = await fetch(`${base}/admin`);
  assert.match(admin.headers.get('x-frame-options') ?? '', /^(DENY|SAMEORIGIN)$/);
  assert.doesNotMatch(admin.headers.get('content-security-policy') ?? '', /arcade\.example\.com/);
});

test('the page reports matches it saw end, once each', async () => {
  const sent = [];
  const memory = new Map();
  globalThis.localStorage = { getItem: (k) => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, String(v)) };
  globalThis.window = { addEventListener() {}, removeEventListener() {} };
  globalThis.Audio = class {
    addEventListener() {}
  };
  globalThis.Arcade = {
    mode: 'embedded',
    kiosk: false,
    player: { id: 'p-sprout', name: 'Sprout' },
    ready: Promise.resolve(null),
    result: (outcome, opts) => sent.push({ outcome, ...opts.meta }),
    status: () => {},
    invite: () => {},
  };
  const { arcadeReport } = await import('../public/js/arcade.js');

  const players = [
    { id: 'me', bot: false, level: null },
    { id: 'bot', bot: true, level: 'hard' },
    { id: 'pal', bot: false, level: null },
  ];
  const state = (match) => ({ you: 'me', players, match });
  const live = (id, order = ['me', 'bot']) => ({ id, phase: 'play', order, winner: null, reason: null, players: { [order[0]]: { wins: 2 }, [order[1]]: { wins: 2 } } });
  const over = (id, winner, order = ['me', 'bot'], reason = 'sets') => ({ ...live(id, order), phase: 'over', winner, reason, players: { [order[0]]: { wins: winner === order[0] ? 3 : 2 }, [order[1]]: { wins: winner === order[1] ? 3 : 2 } } });

  arcadeReport(state(live('m1')), state(over('m1', 'me')));
  arcadeReport(state(live('m1')), state(over('m1', 'me')));
  assert.deepEqual(sent, [{ outcome: 'win', vs: 'bot', sets: '3-2', bot: 'hard' }]);

  arcadeReport(state(live('m2', ['me', 'pal'])), state(over('m2', 'pal', ['me', 'pal'], 'forfeit')));
  assert.deepEqual(sent[1], { outcome: 'loss', vs: 'human', sets: '2-3', forfeit: true });

  // Opened on a finished match, or only watching: nothing.
  arcadeReport(null, state(over('m3', 'me')));
  arcadeReport(state(live('m4', ['pal', 'bot'])), state(over('m4', 'bot', ['pal', 'bot'])));
  assert.equal(sent.length, 2);
});
