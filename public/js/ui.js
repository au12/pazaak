// Small helpers shared by every screen: building elements, toasts, modals,
// and the faces of the people at the table.

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function toast(message, { error = false } = {}) {
  const el = h('div', { class: `toast${error ? ' err' : ''}` }, message);
  document.getElementById('toasts').append(el);
  setTimeout(() => el.remove(), 3500);
}

// ───────── modals ─────────

let lastFocus = null;
export function openModal(id) {
  const m = document.getElementById(id);
  if (!m) return;
  lastFocus = document.activeElement;
  m.hidden = false;
  m.dispatchEvent(new CustomEvent('open'));
  m.querySelector('[data-close]')?.focus();
}
export function closeModal(m) {
  m.hidden = true;
  m.dispatchEvent(new CustomEvent('close'));
  lastFocus?.focus?.();
}
document.addEventListener('click', (e) => {
  const opener = e.target.closest('[data-open]');
  if (opener) {
    openModal(opener.dataset.open);
    document.getElementById('menu')?.setAttribute('hidden', '');
    return;
  }
  const closer = e.target.closest('[data-close]');
  if (closer) return closeModal(closer.closest('.modal'));
  if (e.target.classList?.contains('modal')) closeModal(e.target);
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const open = [...document.querySelectorAll('.modal:not([hidden])')].pop();
  if (open) closeModal(open);
});

export async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = h('textarea', { style: { position: 'fixed', opacity: '0' } });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

// ───────── faces ─────────

const HUES = [28, 200, 340, 160, 265, 50, 185, 5, 120, 300];
const hash = (s) => [...String(s)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);

/** The three computer players each have a face of their own. */
const RIVALS = {
  easy: `<svg viewBox="0 0 64 64"><defs><radialGradient id="re1" cx=".4" cy=".35" r=".8"><stop offset="0" stop-color="#E9B57A"/><stop offset="1" stop-color="#8A4E1E"/></radialGradient></defs>
    <circle cx="32" cy="32" r="30" fill="#2A1A0E" stroke="#C47B3A" stroke-width="2"/>
    <ellipse cx="32" cy="36" rx="19" ry="21" fill="url(#re1)"/>
    <path d="M13 30 Q32 10 51 30 L51 25 Q32 4 13 25Z" fill="#5B3417"/>
    <rect x="14" y="28" width="36" height="11" rx="5.5" fill="#1A1410"/>
    <circle cx="23" cy="33.5" r="4.6" fill="#7FE1FF"/><circle cx="41" cy="33.5" r="4.6" fill="#7FE1FF"/>
    <circle cx="22" cy="32.4" r="1.4" fill="#fff"/><circle cx="40" cy="32.4" r="1.4" fill="#fff"/>
    <path d="M25 47 Q32 52 39 47" stroke="#4A2410" stroke-width="2.4" fill="none" stroke-linecap="round"/></svg>`,
  normal: `<svg viewBox="0 0 64 64"><defs><linearGradient id="rn1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7BE8D8"/><stop offset="1" stop-color="#1F7F78"/></linearGradient></defs>
    <circle cx="32" cy="32" r="30" fill="#0C2A2C" stroke="#4FD1C5" stroke-width="2"/>
    <path d="M32 6 L46 22 L44 50 Q32 60 20 50 L18 22Z" fill="url(#rn1)"/>
    <path d="M32 6 L38 20 L32 24 L26 20Z" fill="#E8C35A"/>
    <path d="M22 32 L29 30 L29 34 L22 35Z M42 32 L35 30 L35 34 L42 35Z" fill="#0A1A1C"/>
    <circle cx="26" cy="32.3" r="1.3" fill="#FFE07A"/><circle cx="38" cy="32.3" r="1.3" fill="#FFE07A"/>
    <path d="M27 45 L37 45" stroke="#0A3A38" stroke-width="2.2" stroke-linecap="round"/>
    <path d="M18 22 L8 16 M46 22 L56 16" stroke="#4FD1C5" stroke-width="2.5" stroke-linecap="round"/></svg>`,
  hard: `<svg viewBox="0 0 64 64"><defs><linearGradient id="rh1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6A5A8E"/><stop offset="1" stop-color="#231B36"/></linearGradient></defs>
    <circle cx="32" cy="32" r="30" fill="#140F1F" stroke="#E5484D" stroke-width="2"/>
    <path d="M12 26 Q14 10 32 9 Q50 10 52 26 L50 46 Q32 60 14 46Z" fill="url(#rh1)"/>
    <path d="M12 22 L4 8 L18 18Z M52 22 L60 8 L46 18Z" fill="#3B2F55"/>
    <path d="M16 30 L48 30 L44 37 L20 37Z" fill="#E5484D"/>
    <path d="M16 30 L48 30 L46 32.5 L18 32.5Z" fill="#FF9C9F"/>
    <path d="M24 45 L40 45 L36 50 L28 50Z" fill="#0F0B18"/>
    <path d="M32 12 L32 26" stroke="#8B7AB8" stroke-width="2"/></svg>`,
};

export function avatar(player) {
  if (player?.bot && RIVALS[player.level]) return `<div class="avatar">${RIVALS[player.level]}</div>`;
  const name = player?.name ?? '?';
  const hue = HUES[hash(name) % HUES.length];
  const initial = [...name.trim()][0]?.toUpperCase() ?? '?';
  return `<div class="avatar"><svg viewBox="0 0 64 64">
    <defs><linearGradient id="av${hue}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue} 70% 62%)"/><stop offset="1" stop-color="hsl(${hue} 60% 30%)"/></linearGradient></defs>
    <path d="M32 2 L58 17 L58 47 L32 62 L6 47 L6 17Z" fill="url(#av${hue})" stroke="rgba(0,0,0,.5)" stroke-width="2"/>
    <path d="M32 6 L54 19 L54 45 L32 58 L10 45 L10 19Z" fill="none" stroke="rgba(255,255,255,.35)" stroke-width="1.2"/>
    <text x="32" y="33" text-anchor="middle" dominant-baseline="central" font-family="Michroma" font-size="24" fill="#fff" style="filter:drop-shadow(0 1px 2px rgba(0,0,0,.6))">${escapeHtml(initial)}</text>
  </svg></div>`;
}

export function rivalFace(level) {
  return RIVALS[level] ?? '';
}

export const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
