// Effects: the drifting starfield behind everything, sparks and a shower of
// cards on one full-screen canvas, and cards that fly from one place to another.

import { flipperEl, cardEl } from './cards.js';

export const calm = () => document.body.classList.contains('calm') || matchMedia('(prefers-reduced-motion: reduce)').matches;

// ───────────────────────── starfield ─────────────────────────

export function starfield(canvas) {
  const ctx = canvas.getContext('2d');
  let stars = [];
  let w = 0;
  let h = 0;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  function resize() {
    w = canvas.clientWidth;
    h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const n = Math.round((w * h) / 5200);
    stars = Array.from({ length: n }, () => ({ x: Math.random() * w, y: Math.random() * h, z: Math.random(), t: Math.random() * 6.28 }));
  }
  resize();
  window.addEventListener('resize', resize);
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(50, now - last) / 1000;
    last = now;
    ctx.clearRect(0, 0, w, h);
    for (const s of stars) {
      if (!calm()) {
        s.x -= (4 + s.z * 10) * dt;
        s.t += dt * (0.6 + s.z);
      }
      if (s.x < -2) {
        s.x = w + 2;
        s.y = Math.random() * h;
      }
      const a = (0.25 + s.z * 0.6) * (0.75 + Math.sin(s.t) * 0.25);
      ctx.fillStyle = s.z > 0.92 ? `rgba(255,214,150,${a})` : `rgba(200,220,255,${a})`;
      const r = 0.4 + s.z * 1.1;
      ctx.fillRect(s.x, s.y, r, r);
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

// ───────────────────────── particles ─────────────────────────

const canvas = document.getElementById('fx');
const ctx = canvas.getContext('2d');
let parts = [];
let running = false;
const dpr = Math.min(2, window.devicePixelRatio || 1);
function fit() {
  canvas.width = innerWidth * dpr;
  canvas.height = innerHeight * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
fit();
window.addEventListener('resize', fit);

function loop() {
  ctx.clearRect(0, 0, innerWidth, innerHeight);
  const dt = 1 / 60;
  parts = parts.filter((p) => (p.life -= dt) > 0);
  for (const p of parts) {
    p.vy += p.g * dt;
    p.vx *= p.drag;
    p.vy *= p.drag;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.rot += p.vr * dt;
    const a = Math.min(1, p.life / p.fade);
    ctx.globalAlpha = a;
    if (p.kind === 'spark') {
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, 6.283);
      ctx.fill();
      ctx.shadowBlur = 0;
    } else if (p.kind === 'ring') {
      const k = 1 - p.life / p.max;
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 3 * (1 - k) + 0.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r + k * p.grow, 0, 6.283);
      ctx.stroke();
    } else if (p.kind === 'card') {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.scale(Math.cos(p.flip + p.rot * 2), 1);
      ctx.fillStyle = '#c9d1d8';
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2 + 1.5, -p.h / 2 + 1.5, p.w - 3, p.h * 0.26);
      ctx.fillRect(-p.w / 2 + 1.5, p.h / 2 - 1.5 - p.h * 0.26, p.w - 3, p.h * 0.26);
      ctx.fillStyle = '#0b141a';
      ctx.fillRect(-p.w / 2 + 2.5, -p.h * 0.16, p.w - 5, p.h * 0.32);
      ctx.restore();
    }
  }
  ctx.globalAlpha = 1;
  if (parts.length) requestAnimationFrame(loop);
  else running = false;
}
function kick() {
  if (!running) {
    running = true;
    requestAnimationFrame(loop);
  }
}

const centerOf = (el) => {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
};

/** A burst of sparks at an element (or a point). */
export function sparks(target, { color = '#FFD36B', count = 26, speed = 260, ring = true } = {}) {
  if (calm()) return;
  const c = target instanceof Element ? centerOf(target) : target;
  for (let i = 0; i < count; i++) {
    const a = Math.random() * 6.283;
    const v = speed * (0.35 + Math.random() * 0.75);
    parts.push({ kind: 'spark', x: c.x, y: c.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: 260, drag: 0.96, r: 1.2 + Math.random() * 2.2, color, life: 0.6 + Math.random() * 0.5, fade: 0.35, rot: 0, vr: 0 });
  }
  if (ring) parts.push({ kind: 'ring', x: c.x, y: c.y, vx: 0, vy: 0, g: 0, drag: 1, r: Math.max(10, (c.w ?? 40) * 0.35), grow: 70, color, life: 0.55, max: 0.55, fade: 0.4, rot: 0, vr: 0 });
  kick();
}

/** A shower of little cards across the screen, for winning a match. */
export function cardShower({ count = 90 } = {}) {
  if (calm()) return;
  const colors = ['#2F7BF5', '#E5484D', '#E2B947', '#2FBF72'];
  for (let i = 0; i < count; i++) {
    const fromLeft = i % 2 === 0;
    parts.push({
      kind: 'card',
      x: fromLeft ? -20 : innerWidth + 20,
      y: innerHeight * (0.55 + Math.random() * 0.4),
      vx: (fromLeft ? 1 : -1) * (180 + Math.random() * 420),
      vy: -(520 + Math.random() * 520),
      g: 620,
      drag: 0.992,
      w: 16 + Math.random() * 8,
      h: 24 + Math.random() * 10,
      color: colors[i % colors.length],
      rot: Math.random() * 6,
      vr: (Math.random() - 0.5) * 9,
      flip: Math.random() * 6,
      life: 3 + Math.random() * 1.5,
      fade: 0.8,
    });
  }
  kick();
}

// ───────────────────────── flying cards ─────────────────────────

/**
 * Flies a card from one element's place to another's. With `turn`, it starts
 * face down and turns over on the way. Resolves when it lands.
 */
export function fly(card, fromEl, toEl, { turn = false, duration = 520, arc = 60, back = false } = {}) {
  if (!fromEl || !toEl || calm()) return Promise.resolve();
  const a = fromEl.getBoundingClientRect();
  const b = toEl.getBoundingClientRect();
  if (!a.width || !b.width) return Promise.resolve();
  const el = turn ? flipperEl(card) : cardEl(card, { back });
  el.classList.add('flying');
  el.style.width = `${b.width}px`;
  el.style.height = `${b.height}px`;
  document.body.append(el);
  const sx = a.width / b.width;
  const dx = a.left + a.width / 2 - b.width / 2;
  const dy = a.top + a.height / 2 - b.height / 2;
  const ex = b.left;
  const ey = b.top;
  const mx = (dx + ex) / 2;
  const my = Math.min(dy, ey) - arc;
  const anim = el.animate(
    [
      { transform: `translate(${dx}px, ${dy}px) scale(${sx}) rotate(-8deg)`, offset: 0 },
      { transform: `translate(${mx}px, ${my}px) scale(${(sx + 1) / 2 + 0.12}) rotate(4deg)`, offset: 0.55 },
      { transform: `translate(${ex}px, ${ey}px) scale(1) rotate(0deg)`, offset: 1 },
    ],
    { duration, easing: 'cubic-bezier(.3,.7,.3,1)', fill: 'forwards' },
  );
  if (turn) {
    el.querySelector('.flipper-inner').animate([{ transform: 'rotateY(0deg)' }, { transform: 'rotateY(180deg)' }], {
      duration: duration * 0.8,
      delay: duration * 0.1,
      easing: 'ease-in-out',
      fill: 'forwards',
    });
  }
  return anim.finished.then(() => el.remove(), () => el.remove());
}

/** Sends the cards on a board off the table, for the end of a set. */
export function sweep(cards, direction = 1) {
  if (calm()) return Promise.resolve();
  const runs = cards.map((el, i) =>
    el.animate(
      [
        { transform: 'none', opacity: 1 },
        { transform: `translate(${direction * (120 + i * 12)}px, ${-40 - i * 6}px) rotate(${direction * (14 + i * 5)}deg)`, opacity: 0 },
      ],
      { duration: 420, delay: i * 40, easing: 'cubic-bezier(.5,0,.8,.3)', fill: 'forwards' },
    ).finished,
  );
  return Promise.all(runs).catch(() => {});
}

export function shake(el) {
  if (calm() || !el) return;
  el.classList.remove('shake');
  void el.offsetWidth;
  el.classList.add('shake');
}
