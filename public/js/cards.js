// Card art, drawn as SVG so it is crisp at any size.
//
// Every card shares one frame: a durasteel plate, a colored rail top and
// bottom with a chevron pointing at the dark glass window where the value
// sits. The rails say what the card is: green for the main deck, blue plus,
// red minus, blue over red for plus/minus, gold for the specials.

import { label, rarityOf } from './rules.js';

const PALETTE = {
  main: { hi: '#7CF0AE', mid: '#2FBF72', lo: '#13774A', glow: '#58F0A0' },
  plus: { hi: '#8DBBFF', mid: '#2F7BF5', lo: '#183F94', glow: '#6AA6FF' },
  minus: { hi: '#FF9C9F', mid: '#E5484D', lo: '#8E1F27', glow: '#FF6E73' },
  gold: { hi: '#FFE9A6', mid: '#E2B947', lo: '#8C6516', glow: '#FFD36B' },
};

let uid = 0;

function rail(id, c, top) {
  // A band with a chevron pointing toward the window.
  const y0 = top ? 7 : 101;
  const y1 = top ? 39 : 133;
  const tip = top ? 47 : 93;
  const base = top ? y1 : y0;
  const pts = top
    ? `9,${y0} 91,${y0} 91,${y1 - 6} 62,${y1 - 6} 50,${tip - 3} 38,${y1 - 6} 9,${y1 - 6}`
    : `9,${y1} 91,${y1} 91,${y0 + 6} 62,${y0 + 6} 50,${tip + 3} 38,${y0 + 6} 9,${y0 + 6}`;
  return `
    <linearGradient id="${id}" x1="0" y1="${top ? 0 : 1}" x2="0" y2="${top ? 1 : 0}">
      <stop offset="0" stop-color="${c.hi}"/><stop offset=".45" stop-color="${c.mid}"/><stop offset="1" stop-color="${c.lo}"/>
    </linearGradient>
    <polygon points="${pts}" fill="url(#${id})" stroke="rgba(0,0,0,.45)" stroke-width="1"/>
    <polyline points="${top ? `10,${y0 + 1.5} 90,${y0 + 1.5}` : `10,${y1 - 1.5} 90,${y1 - 1.5}`}" stroke="rgba(255,255,255,.55)" stroke-width="1.2" fill="none"/>
    <rect x="${top ? 16 : 16}" y="${top ? y0 + 7 : y1 - 13}" width="20" height="5" rx="2.5" fill="rgba(255,255,255,.28)"/>
    <rect x="${64}" y="${top ? y0 + 7 : y1 - 13}" width="20" height="5" rx="2.5" fill="rgba(0,0,0,.18)"/>
    ${base ? '' : ''}`;
}

function badge(sign, color) {
  // The round sign in the top corner: + for plus, − for minus, ± for either.
  const glyph = sign === '+' ? 'M-5 0H5M0 -5V5' : sign === '-' ? 'M-5 0H5' : 'M-4.5 -2.5H4.5M0 -7V2M-4.5 5H4.5';
  return `<g transform="translate(84 14)">
    <circle r="10" fill="#F4F7FA" stroke="${color}" stroke-width="2.4"/>
    <path d="${glyph}" stroke="${color}" stroke-width="3" stroke-linecap="round" fill="none"/>
  </g>`;
}

function gem(rarity) {
  if (rarity === 'uncommon') return `<g transform="translate(13 127)"><path d="M0 -5 L5 0 L0 5 L-5 0 Z" fill="#5BE3D2" stroke="#0B3B39" stroke-width="1"/></g>`;
  if (rarity === 'rare') return `<g transform="translate(13 127)"><path d="M0 -6.5 L1.8 -1.8 L6.5 0 L1.8 1.8 L0 6.5 L-1.8 1.8 L-6.5 0 L-1.8 -1.8 Z" fill="#FFE07A" stroke="#6B4A0A" stroke-width="1"/></g>`;
  return '';
}

/**
 * The SVG markup for a card face. `card`: a side card { kind, v } or a board
 * card { src, kind, v, value, flipped, sign }.
 */
export function faceSvg(card, { rarity = false } = {}) {
  const id = `k${(uid += 1)}`;
  const kind = card.kind;
  let top = PALETTE.gold;
  let bottom = PALETTE.gold;
  let sign = null;
  let signColor = '#2F7BF5';
  let text = label(card);
  let small = null;

  if (kind === 'main') {
    top = bottom = PALETTE.main;
    text = String(card.value ?? card.v);
  } else if (kind === 'plus') {
    top = bottom = PALETTE.plus;
    sign = '+';
  } else if (kind === 'minus') {
    top = bottom = PALETTE.minus;
    sign = '-';
    signColor = '#E5484D';
  } else if (kind === 'pm') {
    top = PALETTE.plus;
    bottom = PALETTE.minus;
    sign = '±';
    signColor = '#5A4FD8';
  }
  // On the board a card shows what it counts for.
  if (card.src === 'side' && (kind === 'pm' || kind === 'tie')) text = `${card.value > 0 ? '+' : '−'}${Math.abs(card.value)}${kind === 'tie' ? 'T' : ''}`;
  if (card.src === 'side' && kind === 'double') small = `${card.value > 0 ? '+' : card.value < 0 ? '−' : ''}${Math.abs(card.value)}`;
  if (card.flipped) {
    text = `${card.value > 0 ? '' : '−'}${Math.abs(card.value)}`;
    if (card.src === 'side' && card.value > 0) text = `+${card.value}`;
  }
  const flippedGold = card.flipped;
  const glow = flippedGold ? PALETTE.gold.glow : top.glow;
  const long = text.length >= 3;
  const size = long ? 19 : 25;

  return `<svg class="card-svg" viewBox="0 0 100 140" aria-hidden="true">
  <defs>
    <linearGradient id="${id}p" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#EEF2F5"/><stop offset=".35" stop-color="#B9C2CA"/><stop offset=".6" stop-color="#D5DBE0"/><stop offset="1" stop-color="#7D8790"/>
    </linearGradient>
    <linearGradient id="${id}w" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#03080B"/><stop offset="1" stop-color="#12222A"/>
    </linearGradient>
    <radialGradient id="${id}g" cx=".5" cy=".5" r=".6">
      <stop offset="0" stop-color="${glow}" stop-opacity=".38"/><stop offset="1" stop-color="${glow}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect x="1" y="1" width="98" height="138" rx="9" fill="url(#${id}p)" stroke="#2A3138" stroke-width="1.5"/>
  <rect x="3.5" y="3.5" width="93" height="133" rx="7" fill="none" stroke="rgba(255,255,255,.65)" stroke-width="1"/>
  ${rail(`${id}t`, top, true)}
  ${rail(`${id}b`, bottom, false)}
  <rect x="11" y="48" width="78" height="44" rx="4" fill="url(#${id}w)" stroke="${flippedGold ? '#E2B947' : '#1B252C'}" stroke-width="${flippedGold ? 2.5 : 1.5}"/>
  <rect x="11" y="48" width="78" height="44" rx="4" fill="url(#${id}g)"/>
  <rect x="13" y="50" width="74" height="6" rx="2" fill="rgba(255,255,255,.07)"/>
  <text x="50" y="${small ? 63 : 70}" text-anchor="middle" dominant-baseline="central" class="card-num" font-size="${small ? 18 : size}" fill="#F5FAFF" style="filter: drop-shadow(0 0 3px ${glow})">${text}</text>
  ${small ? `<text x="50" y="83" text-anchor="middle" dominant-baseline="central" class="card-num" font-size="11" fill="${PALETTE.gold.hi}">${small}</text>` : ''}
  ${sign ? badge(sign, signColor) : ''}
  ${rarity && card.src !== 'main' && kind !== 'main' ? gem(rarityOf(card)) : ''}
</svg>`;
}

export function backSvg() {
  const id = `b${(uid += 1)}`;
  return `<svg class="card-svg" viewBox="0 0 100 140" aria-hidden="true">
  <defs>
    <linearGradient id="${id}p" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#A9B3BC"/><stop offset=".45" stop-color="#5E6973"/><stop offset=".7" stop-color="#8C969F"/><stop offset="1" stop-color="#3D4650"/>
    </linearGradient>
    <radialGradient id="${id}a" cx=".5" cy=".5" r=".5">
      <stop offset="0" stop-color="#FFD48A"/><stop offset=".5" stop-color="#F3A73B"/><stop offset="1" stop-color="#7A3E06"/>
    </radialGradient>
  </defs>
  <rect x="1" y="1" width="98" height="138" rx="9" fill="url(#${id}p)" stroke="#1E252B" stroke-width="1.5"/>
  <rect x="7" y="7" width="86" height="126" rx="6" fill="none" stroke="rgba(0,0,0,.35)" stroke-width="1.5"/>
  <rect x="8" y="8" width="84" height="124" rx="5" fill="none" stroke="rgba(255,255,255,.25)" stroke-width="1"/>
  <g stroke="rgba(0,0,0,.28)" stroke-width="3" fill="none" stroke-linejoin="round">
    <path d="M28 40 L50 26 L72 40"/><path d="M28 54 L50 40 L72 54"/>
    <path d="M28 86 L50 100 L72 86"/><path d="M28 100 L50 114 L72 100"/>
  </g>
  <g stroke="rgba(255,255,255,.35)" stroke-width="1" fill="none" stroke-linejoin="round">
    <path d="M28 39 L50 25 L72 39"/><path d="M28 53 L50 39 L72 53"/>
    <path d="M28 85 L50 99 L72 85"/><path d="M28 99 L50 113 L72 99"/>
  </g>
  <circle cx="50" cy="70" r="11" fill="#20272D" stroke="rgba(255,255,255,.3)"/>
  <circle cx="50" cy="70" r="7" fill="url(#${id}a)"/>
  <circle cx="48" cy="68" r="2" fill="rgba(255,255,255,.7)"/>
</svg>`;
}

/** A card element. Options: { back, rarity, cls } */
export function cardEl(card, { back = false, rarity = false, cls = '' } = {}) {
  const el = document.createElement('div');
  el.className = `card ${cls}`.trim();
  if (card?.id) el.dataset.id = card.id;
  el.innerHTML = back || !card ? backSvg() : faceSvg(card, { rarity });
  if (!back && card) el.setAttribute('aria-label', cardName(card));
  return el;
}

/** A card that can turn over: back on one side, face on the other. */
export function flipperEl(card) {
  const el = document.createElement('div');
  el.className = 'card flipper';
  el.innerHTML = `<div class="flipper-inner"><div class="flipper-back">${backSvg()}</div><div class="flipper-face">${faceSvg(card)}</div></div>`;
  return el;
}

export function cardName(card) {
  if (card.kind === 'main') return `Main deck ${card.value ?? card.v}`;
  const names = { plus: 'Plus', minus: 'Minus', pm: 'Plus/minus', flip: 'Flip', double: 'Double', tie: 'Tiebreaker' };
  return `${names[card.kind] ?? 'Card'} ${label(card)}`;
}
