/*
 * The score ceiling a run of N blocks can reach. Mirrors maxScore() in ../../public/rules.js, which the game uses;
 * the server test suite checks the two agree. Integer arithmetic only (consensus code).
 */

export const MAX_MULT = 32;
export const TIER_BLOCKS = 30;
export const MAX_TIER = 20;
export const MAX_POWER = 8;
/** a run can't be longer than this many blocks (about 5.8 days at 500ms) */
export const MAX_RUN_BLOCKS = 1_000_000;

export function tierOf(n: number): number {
    return Math.min(Math.floor(n / TIER_BLOCKS), MAX_TIER);
}

/** Per block: at most one boss-sized kill plus a drop and feat bonuses, all at the top multiplier. */
export function blockCap(n: number): bigint {
    return BigInt(2500 + 1000 * tierOf(n)) * BigInt(MAX_MULT);
}

export function maxScore(blocks: number): bigint {
    let total = 0n;
    // full tiers in closed form, then the remainder
    const fullTiers = Math.min(Math.floor(blocks / TIER_BLOCKS), MAX_TIER);
    for (let t = 0; t < fullTiers; t++) total += blockCap(t * TIER_BLOCKS) * BigInt(TIER_BLOCKS);
    const rest = blocks - fullTiers * TIER_BLOCKS;
    total += blockCap(fullTiers * TIER_BLOCKS) * BigInt(rest);
    return total;
}

/** kills per block: one spawn, plus up to two splitter minis */
export const MAX_KILLS_PER_BLOCK = 3;
