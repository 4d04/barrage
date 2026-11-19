// Block Barrage rules, shared by the game (browser), the server (score checks) and, for maxScore, the chain plugin
// (plugin/src/arcade/rules.ts mirrors it; test/rules.test.js checks they agree).
//
// Every block spawns exactly one invader. What it is, where it enters and what it drops come from the block's hash,
// so everyone playing sees the same invader for the same block. How tough it is comes from how long the run has
// lasted: every TIER_BLOCKS blocks (12 seconds) the tier goes up.

export const BLOCK_MS = 500;
export const MAX_MULT = 32;
export const TIER_BLOCKS = 24;
export const MAX_TIER = 20;
export const MAX_POWER = 8;
export const CENTURY_MIN_BLOCKS = 20; // no boss in the first 10 seconds of a run
export const MAX_KILLS_PER_BLOCK = 3;

export const tierOf = (n) => Math.min(Math.floor(n / TIER_BLOCKS), MAX_TIER);

// base points are multiplied by (1 + tier) and then by the multiplier
export const ENEMIES = {
  drone:    { hp: 1, pts: 10,   unlock: 0, w: 10, h: 8 },
  zigzag:   { hp: 1, pts: 20,   unlock: 0, w: 10, h: 8 },
  gunner:   { hp: 2, pts: 40,   unlock: 1, w: 11, h: 9 },
  splitter: { hp: 2, pts: 30,   unlock: 2, w: 11, h: 9 },
  mini:     { hp: 1, pts: 15,   unlock: 99, w: 6, h: 5 },
  tank:     { hp: 6, pts: 80,   unlock: 3, w: 15, h: 11 },
  diver:    { hp: 1, pts: 50,   unlock: 4, w: 9, h: 9 },
  weaver:   { hp: 4, pts: 100,  unlock: 5, w: 13, h: 9 },
  century:  { hp: 30, pts: 1000, unlock: 99, w: 32, h: 14 },
  // every run opens with one, born from the block the run starts on; it stays until you take it out
  blockmonster: { hp: 24, pts: 500, unlock: 99, w: 26, h: 18 },
};
const ROSTER = ['drone', 'zigzag', 'gunner', 'splitter', 'tank', 'diver', 'weaver'];

// bonus points for feats (also multiplied); see the multiplier section in README.md
export const FEATS = {
  finality: 25,   // killed in the same block it spawned
  double: 50, triple: 100, mega: 200, // several kills at once
  combo: 100,     // every 8 kills without letting the chain cool
  unbroken: 200,  // every 40 blocks without taking a hit
  century: 500,   // a century boss
  blockmonster: 300, // the run's opening boss
  maxedPickup: 100, // a power chip when already at max power
};

// hex hash -> bytes; practice mode (no chain) uses a local stand-in hash
function bytesOf(hash, height) {
  const out = [];
  if (typeof hash === 'string' && /^[0-9a-f]{16,}$/i.test(hash)) {
    for (let i = 0; i + 1 < hash.length && out.length < 32; i += 2) out.push(parseInt(hash.slice(i, i + 2), 16));
  } else {
    let x = (height * 2654435761) >>> 0;
    for (let i = 0; i < 32; i++) { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; out.push(x & 255); }
  }
  while (out.length < 32) out.push(0);
  return out;
}

// The invader block `height` (with `hash`) spawns, `n` blocks into a run.
export function spawnFor(height, hash, n) {
  const b = bytesOf(hash, height);
  const tier = tierOf(n);
  const century = height % 100 === 0 && n >= CENTURY_MIN_BLOCKS;
  let type;
  if (century) type = 'century';
  else {
    const unlocked = ROSTER.filter((t) => ENEMIES[t].unlock <= tier);
    // the newest unlocked type gets two shares, so each tier feels different
    const i = b[0] % (unlocked.length + 1);
    type = unlocked[Math.min(i, unlocked.length - 1)];
  }
  const e = ENEMIES[type];
  // toughness grows 35% per tier, so the weapon upgrades stay necessary; divers stay fragile (they ram you)
  const hp = century ? e.hp + 15 * tier : type === 'diver' ? e.hp + Math.floor(tier / 4) : Math.round(e.hp * (1 + 0.35 * tier));
  // drops: P power chip, S shield, R rapid fire, B bomb, H extra life
  const r = b[2];
  let drop = null;
  if (century) drop = 'P';
  else if (r < 22) drop = 'P';
  else if (r < 31) drop = 'R';
  else if (r < 38) drop = 'S';
  else if (r < 43) drop = 'B';
  else if (r < 46) drop = 'H';
  return {
    type, height, tier, hp,
    x: 0.08 + (b[1] / 255) * 0.84,   // 0..1 across the playfield
    speed: 1 + 0.08 * tier,
    pts: e.pts * (1 + tier),
    drop,
    dir: b[3] & 1 ? 1 : -1,
    phase: b[4] / 255,
    hash: typeof hash === 'string' ? hash.slice(0, 8) : null,
  };
}

// The highest score a run of `blocks` blocks can reach: per block, at most one boss-sized kill, a drop and feats,
// all at the top multiplier. The chain plugin enforces the same ceiling.
export function blockCap(n) { return (2500 + 1000 * tierOf(n)) * MAX_MULT; }
export function maxScore(blocks) {
  let total = 0;
  const full = Math.min(Math.floor(blocks / TIER_BLOCKS), MAX_TIER);
  for (let t = 0; t < full; t++) total += blockCap(t * TIER_BLOCKS) * TIER_BLOCKS;
  total += blockCap(full * TIER_BLOCKS) * (blocks - full * TIER_BLOCKS);
  return total;
}

// weapon by power level: shots per second and the pattern (angles in degrees, wings, laser, homing)
export const WEAPONS = [
  null,
  { rate: 5, angles: [0] },
  { rate: 5, angles: [0], twin: true },
  { rate: 7, angles: [0], twin: true },
  { rate: 7, angles: [-10, 0, 10] },
  { rate: 8, angles: [-10, 0, 10], wings: true },
  { rate: 8, angles: [-12, 12], laser: true, wings: true },
  { rate: 9, angles: [-20, -10, 0, 10, 20], wings: true },
  { rate: 9, angles: [-20, -10, 0, 10, 20], wings: true, homing: true },
];
export const WEAPON_NAMES = ['', 'BLASTER', 'TWIN', 'TWIN+', 'SPREAD', 'WINGS', 'LASER', 'FAN', 'SWARM'];
