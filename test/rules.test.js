import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnFor, maxScore, tierOf, ENEMIES, FEATS, MAX_MULT, TIER_BLOCKS } from '../public/rules.js';
import { validateScore } from '../server/validate.js';

const plugin = await import('../plugin/dist/arcade/rules.js');
const HASH = 'a3f09c11d2e8b7c4559e0d1f6a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d';

test('the plugin and the game agree on the score ceiling', () => {
  for (const n of [0, 1, 29, 30, 31, 299, 600, 601, 1234, 10_000, 1_000_000]) assert.equal(BigInt(maxScore(n)), plugin.maxScore(n), `n=${n}`);
  assert.equal(plugin.MAX_MULT, MAX_MULT);
  assert.equal(plugin.TIER_BLOCKS, TIER_BLOCKS);
});

test('the ceiling covers the most a block can pay: boss kill, drop, and every feat at the top multiplier', () => {
  for (const n of [0, 45, 300, 900]) {
    const t = tierOf(n);
    const perfect = (ENEMIES.century.pts * (1 + t) + FEATS.century + FEATS.finality + FEATS.mega + FEATS.combo + FEATS.unbroken + FEATS.maxedPickup) * MAX_MULT;
    assert.ok(maxScore(n + 1) - maxScore(n) >= perfect, `tier ${t}`);
  }
});

test('the same block always spawns the same invader', () => {
  assert.deepEqual(spawnFor(4821, HASH, 50), spawnFor(4821, HASH, 50));
  const kinds = new Set();
  for (let h = 1; h <= 400; h++) kinds.add(spawnFor(h, null, 40).type);
  assert.ok(kinds.size >= 2);
});

test('invaders unlock by tier, and blocks ending in 00 bring the century boss', () => {
  for (let h = 1; h < 300; h++) if (h % 100) assert.equal(spawnFor(h, null, 5).type, 'drone');
  assert.equal(spawnFor(4800, HASH, 25).type, 'century');
  assert.notEqual(spawnFor(4800, HASH, 5).type, 'century', 'no boss in the first 10 seconds');
  const late = new Set();
  for (let h = 1; h <= 2000; h++) if (h % 100) late.add(spawnFor(h, null, 200).type);
  assert.deepEqual([...late].sort(), ['diver', 'drone', 'gunner', 'splitter', 'tank', 'weaver', 'zigzag']);
});

test('server checks: a good run passes; bad ones are refused', () => {
  const run = { startHeight: 1000, startedAt: 0 };
  const good = { initials: 'ace', score: 5000, endHeight: 1060, kills: 40, bestMultiplier: 6, powerLevel: 4 };
  const ok = validateScore({ run, body: good, tip: 1061, now: 30_000 });
  assert.equal(ok.ok, true);
  assert.equal(ok.fields.initials, 'ACE');
  const bad = (over, tip = 1061, now = 30_000) => validateScore({ run, body: { ...good, ...over }, tip, now }).error;
  assert.match(bad({ initials: 'TOOLONG' }), /initials/);
  assert.match(bad({ endHeight: 1070 }), /tip/);
  assert.match(bad({ endHeight: 1000 }), /after the start/);
  assert.match(bad({ score: maxScore(60) + 1 }), /higher/);
  assert.match(bad({ kills: 999 }), /kills/);
  assert.match(bad({ bestMultiplier: 64 }), /multiplier/);
  assert.match(bad({}, 1061, 10_000), /faster than the chain/);
  assert.match(bad({ score: 1.5 }), /numbers/);
  assert.match(validateScore({ run: undefined, body: good, tip: 1061, now: 30_000 }).error, /unknown/);
});
