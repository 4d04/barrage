/* In-memory tests: the real CheckTx/DeliverTx handlers over a MemoryBackend. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const AUTH = 'aa'.repeat(20);
process.env.BARRAGE_ARCADE_AUTHORITY = AUTH;

const require = createRequire(import.meta.url);
const { types } = require('../dist/proto/index.cjs');
const { ContractAsync } = await import('../dist/contract/contract.js');
const { route } = await import('../dist/contract/rpc.js');
const { MemoryBackend, Store } = await import('../dist/arcade/store.js');
const K = await import('../dist/arcade/keys.js');
const { maxScore } = await import('../dist/arcade/rules.js');

const SEND_FEE = 10_000;
const hexb = (h: string) => Buffer.from(h, 'hex');

function chain() {
    const backend = new MemoryBackend();
    backend.data.set(Buffer.from(K.KeyForFeeParams()).toString('hex'), types.FeeParams.encode({ sendFee: SEND_FEE }).finish());
    backend.data.set(Buffer.from(K.KeyForAccount(hexb(AUTH))).toString('hex'), types.Account.encode({ address: hexb(AUTH), amount: 1_000_000_000 }).finish());
    return { backend, Config: { ChainId: 2 } };
}

let runSeq = 0;
function scoreTx(over: Record<string, unknown> = {}, fee = SEND_FEE) {
    const fields = {
        address: hexb(AUTH), runId: Buffer.alloc(16, ++runSeq), initials: 'ACE', score: 1000, startHeight: 100, endHeight: 160,
        kills: 30, bestMultiplier: 4, powerLevel: 3, ...over
    };
    const value = types.MessageSubmitScore.encode(types.MessageSubmitScore.create(fields)).finish();
    return { tx: { messageType: 'submit_score', msg: { type_url: 'type.googleapis.com/types.MessageSubmitScore', value }, fee }, fields };
}

async function deliver(c: ReturnType<typeof chain>, over: Record<string, unknown> = {}, height = 200, fee = SEND_FEE) {
    const { tx } = scoreTx(over, fee);
    const check = await ContractAsync.CheckTx(c, { tx, height });
    const res = await ContractAsync.DeliverTx(c, { tx, height });
    return { check, res };
}

const board = async (c: ReturnType<typeof chain>) => (await route(new Store(c.backend), '/barrage/board?limit=100'))[1] as { top: { initials: string; score: number }[] };

test('a valid score lands on the board, charges the fee, and emits an event', async () => {
    const c = chain();
    const { check, res } = await deliver(c);
    assert.equal(check.error, undefined);
    assert.equal(Buffer.from(check.authorizedSigners[0]).toString('hex'), AUTH);
    assert.equal(res.error, undefined);
    assert.equal(res.events.length, 1);
    assert.deepEqual((await board(c)).top.map((e) => [e.initials, e.score]), [['ACE', 1000]]);
    const acct = types.Account.decode(c.backend.data.get(Buffer.from(K.KeyForAccount(hexb(AUTH))).toString('hex')));
    assert.equal(Number(acct.amount), 1_000_000_000 - SEND_FEE);
    const [, stats] = await route(new Store(c.backend), '/barrage/stats');
    assert.deepEqual(stats, { runs: 1, kills: 30, bestScore: 1000, blocksPlayed: 60 });
});

test('only the arcade authority may submit', async () => {
    const c = chain();
    const { check, res } = await deliver(c, { address: hexb('bb'.repeat(20)) });
    assert.match(check.error.msg, /only the arcade authority/);
    assert.match(res.error.msg, /only the arcade authority/);
});

test('shape checks: initials, heights, score ceiling, kills, multiplier, power', async () => {
    const c = chain();
    const cases: [Record<string, unknown>, RegExp][] = [
        [{ initials: 'abcd' }, /initials/],
        [{ initials: '' }, /initials/],
        [{ endHeight: 100 }, /after startHeight/],
        [{ score: Number(maxScore(60)) + 1 }, /higher than those blocks allow/],
        [{ kills: 60 * 3 + 4 }, /more kills/],
        [{ bestMultiplier: 33 }, /multiplier/],
        [{ powerLevel: 9 }, /power/],
        [{ runId: Buffer.alloc(8) }, /runId/]
    ];
    for (const [over, re] of cases) assert.match((await deliver(c, over)).check.error.msg, re, JSON.stringify(over));
    assert.equal((await deliver(c, { score: Number(maxScore(60)) })).check.error, undefined);
});

test('future end height, duplicate run, and low fee are refused', async () => {
    const c = chain();
    assert.match((await deliver(c, { endHeight: 201 })).check.error.msg, /future/);
    const { tx } = scoreTx();
    assert.equal((await ContractAsync.DeliverTx(c, { tx, height: 200 })).error, undefined);
    assert.match((await ContractAsync.CheckTx(c, { tx, height: 201 })).error.msg, /already recorded/);
    assert.match((await ContractAsync.DeliverTx(c, { tx, height: 201 })).error.msg, /already recorded/);
    assert.equal((await deliver(c, {}, 200, 9_999)).check.error.code, 14);
});

test('board order: score, then earlier end height; capped at 100', async () => {
    const c = chain();
    await deliver(c, { initials: 'B', score: 500, endHeight: 150 });
    await deliver(c, { initials: 'A', score: 500, endHeight: 140 });
    await deliver(c, { initials: 'C', score: 900 });
    assert.deepEqual((await board(c)).top.map((e) => e.initials), ['C', 'A', 'B']);
    for (let i = 0; i < 105; i++) await deliver(c, { initials: 'Z', score: 1000 + i });
    const top = (await board(c)).top;
    assert.equal(top.length, 100);
    assert.equal(top[0].score, 1104);
    const [, run] = await route(new Store(c.backend), `/barrage/run?id=${'01'.repeat(16)}`);
    assert.ok(run);
});

test('two instances replaying the same txs write byte-identical state', async () => {
    const a = chain(), b = chain();
    for (const c of [a, b]) {
        runSeq = 1000;
        for (let i = 0; i < 20; i++) await deliver(c, { initials: `P${i % 10}`, score: (i * 7919) % 5000 }, 200 + i);
    }
    assert.deepEqual(a.backend.log, b.backend.log);
});

test('fails closed without an authority', async () => {
    const c = chain();
    delete process.env.BARRAGE_ARCADE_AUTHORITY;
    try {
        assert.match((await deliver(c)).check.error.msg, /not configured/);
    } finally {
        process.env.BARRAGE_ARCADE_AUTHORITY = AUTH;
    }
});
