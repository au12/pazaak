// Easy-to-say room codes: "dusty-cantina-42".

import { randomInt } from 'node:crypto';

const ADJECTIVES = `amber binary brass bright cobalt copper crimson dusty ember feral gilded golden hazy humming ionic iron jaded keen lucky lunar misty molten neon nimble noble orbital outer polar quiet rapid rogue rusty scarlet shady silent silver sly solar steady stellar swift tidal twin velvet violet wild`.split(/\s+/);

const NOUNS = `asteroid beacon cantina comet credit dealer deck docking drifter freighter gambit hangar hustle lantern moon nebula outpost parsec pilot planet pulsar quasar raider relay runner saloon shark shuttle smuggler spacer stack starport station stranger table thruster trader vector voyager wager`.split(/\s+/);

export function roomCode() {
  const pick = (list) => list[randomInt(list.length)];
  return `${pick(ADJECTIVES)}-${pick(NOUNS)}-${String(randomInt(100)).padStart(2, '0')}`;
}

/** Text that arrived from outside, as a string. Anything else counts as empty. */
export const text = (raw) => (typeof raw === 'string' ? raw : typeof raw === 'number' ? String(raw) : '');

export function normalizeCode(raw) {
  return text(raw)
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}
