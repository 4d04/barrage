/* The arcade: one message, submit_score, relayed by the arcade server's key. Deterministic: no clocks, no I/O. */

import * as K from './keys.js';
import { MAX_KILLS_PER_BLOCK, MAX_MULT, MAX_POWER, MAX_RUN_BLOCKS, maxScore } from './rules.js';
import { type Store, TxError } from './store.js';

export const BOARD_SIZE = 100;
export const INITIALS_RE = /^[A-Z0-9]{1,3}$/;

export interface BoardEntry {
    /** run id, hex */
    run: string;
    initials: string;
    score: number;
    kills: number;
    bestMultiplier: number;
    powerLevel: number;
    startHeight: number;
    endHeight: number;
    /** the block the score was recorded in */
    sealedHeight: number;
}

export interface RunRecord extends BoardEntry {
    /** rank when recorded (1-based), 0 if it missed the board */
    rank: number;
}

export interface Stats {
    runs: number;
    kills: number;
    bestScore: number;
    blocksPlayed: number;
}

export interface ScoreMsg {
    runId: Uint8Array;
    initials: string;
    score: bigint;
    startHeight: bigint;
    endHeight: bigint;
    kills: number;
    bestMultiplier: number;
    powerLevel: number;
}

export interface ArcadeEventOut {
    kind: string;
    address: Uint8Array;
    data: unknown;
}

/** Authority of the arcade (the server's relay key). Fail closed: unset means no score is accepted. */
export function arcadeAuthority(): Uint8Array | null {
    const hex = (process.env.BARRAGE_ARCADE_AUTHORITY || '').toLowerCase();
    return /^[0-9a-f]{40}$/.test(hex) ? new Uint8Array(Buffer.from(hex, 'hex')) : null;
}

const eq = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((x, i) => x === b[i]);
const hex = (b: Uint8Array): string => Buffer.from(b).toString('hex');

/** Stateless checks, shared by CheckTx and DeliverTx. Returns an error message or null. */
export function checkShape(signer: Uint8Array, m: ScoreMsg): string | null {
    const auth = arcadeAuthority();
    if (!auth) return 'arcade authority not configured';
    if (signer.length !== 20) return 'address must be 20 bytes';
    if (!eq(signer, auth)) return 'only the arcade authority can submit scores';
    if (m.runId.length !== 16) return 'runId must be 16 bytes';
    if (!INITIALS_RE.test(m.initials)) return 'initials must be 1-3 of A-Z 0-9';
    if (m.startHeight < 1n || m.endHeight <= m.startHeight) return 'endHeight must be after startHeight';
    const blocks = m.endHeight - m.startHeight;
    if (blocks > BigInt(MAX_RUN_BLOCKS)) return 'run too long';
    if (m.score > maxScore(Number(blocks))) return 'score is higher than those blocks allow';
    if (BigInt(m.kills) > blocks * BigInt(MAX_KILLS_PER_BLOCK) + 3n) return 'more kills than enemies spawned';
    if (m.bestMultiplier < 1 || m.bestMultiplier > MAX_MULT) return 'bad multiplier';
    if (m.powerLevel < 1 || m.powerLevel > MAX_POWER) return 'bad power level';
    return null;
}

/** Board order: score high to low, then whoever got there first, then run id. Total, so every node sorts alike. */
export function compareEntries(a: BoardEntry, b: BoardEntry): number {
    if (a.score !== b.score) return b.score - a.score;
    if (a.endHeight !== b.endHeight) return a.endHeight - b.endHeight;
    return a.run < b.run ? -1 : a.run > b.run ? 1 : 0;
}

export async function getBoard(store: Store): Promise<BoardEntry[]> {
    return (await store.getJSON<BoardEntry[]>(K.KeyBoard())) ?? [];
}

export async function getStats(store: Store): Promise<Stats> {
    return (await store.getJSON<Stats>(K.KeyStats())) ?? { runs: 0, kills: 0, bestScore: 0, blocksPlayed: 0 };
}

/** State checks that CheckTx can afford (one read): the run id is unused and the run already ended. */
export async function precheck(store: Store, height: number, m: ScoreMsg): Promise<void> {
    if (m.endHeight > BigInt(height)) throw new TxError('endHeight is in the future');
    if (await store.get(K.KeyRun(m.runId))) throw new TxError('run already recorded');
}

export async function submitScore(store: Store, height: number, signer: Uint8Array, m: ScoreMsg, events: ArcadeEventOut[]): Promise<RunRecord> {
    await precheck(store, height, m);
    // scores are bounded by maxScore (under 10^12 for MAX_RUN_BLOCKS), so Number is exact
    const entry: BoardEntry = {
        run: hex(m.runId),
        initials: m.initials,
        score: Number(m.score),
        kills: m.kills,
        bestMultiplier: m.bestMultiplier,
        powerLevel: m.powerLevel,
        startHeight: Number(m.startHeight),
        endHeight: Number(m.endHeight),
        sealedHeight: height
    };
    const board = await getBoard(store);
    const next = [...board, entry].sort(compareEntries).slice(0, BOARD_SIZE);
    const rank = next.indexOf(entry) + 1;
    if (rank > 0) store.setJSON(K.KeyBoard(), next);
    const rec: RunRecord = { ...entry, rank };
    store.setJSON(K.KeyRun(m.runId), rec);
    const st = await getStats(store);
    store.setJSON(K.KeyStats(), {
        runs: st.runs + 1,
        kills: st.kills + m.kills,
        bestScore: Math.max(st.bestScore, entry.score),
        blocksPlayed: st.blocksPlayed + (entry.endHeight - entry.startHeight)
    });
    events.push({ kind: 'score', address: signer, data: { run: entry.run, initials: entry.initials, score: entry.score, rank } });
    return rec;
}
