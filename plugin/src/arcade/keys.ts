/* State keys. Core keys use the template's layout; arcade keys live under the multi-byte "barrage" prefix. */

export const BARRAGE_PREFIX = Buffer.from('barrage');

/** Length-prefixed segments (same encoding as the template's JoinLenPrefix); a prefix of segments is a byte prefix. */
export function lenPrefix(...parts: Uint8Array[]): Uint8Array {
    let n = 0;
    for (const p of parts) {
        if (p.length > 255) throw new Error('key segment too long');
        n += 1 + p.length;
    }
    const out = new Uint8Array(n);
    let i = 0;
    for (const p of parts) {
        out[i++] = p.length;
        out.set(p, i);
        i += p.length;
    }
    return out;
}

export function u64(v: number | bigint): Uint8Array {
    const b = Buffer.alloc(8);
    b.writeBigUInt64BE(BigInt(v));
    return b;
}

const s = (x: string): Uint8Array => Buffer.from(x, 'utf8');
const K = (...parts: Uint8Array[]): Uint8Array => lenPrefix(BARRAGE_PREFIX, ...parts);

// ---- core (template layout)
export const KeyForAccount = (addr: Uint8Array): Uint8Array => lenPrefix(Buffer.from([1]), addr);
export const KeyForPool = (id: number | bigint): Uint8Array => lenPrefix(Buffer.from([2]), u64(id));
export const KeyForFeeParams = (): Uint8Array => lenPrefix(Buffer.from([7]), s('/f/'));

// ---- arcade
/** the top of the leaderboard, one canonical JSON array (at most BOARD_SIZE entries) */
export const KeyBoard = (): Uint8Array => K(s('board'));
/** every recorded run, so a run id can be submitted once */
export const KeyRun = (runId: Uint8Array): Uint8Array => K(s('run'), runId);
/** totals: runs, kills, best score */
export const KeyStats = (): Uint8Array => K(s('stats'));
