/* Block Barrage contract: message registry, CheckTx (shape, authority, fee, run unused), DeliverTx. */

import Long from 'long';

import { types } from '../proto/types.js';
import { fileDescriptorProtos } from '../proto/descriptors.js';
import { type ArcadeEventOut, type ScoreMsg, checkShape, precheck, submitScore } from '../arcade/arcade.js';
import { chargeFee, sendFee, toBig } from '../arcade/core.js';
import { BARRAGE_PREFIX } from '../arcade/keys.js';
import { type Backend, type Entry, Store, TxError } from '../arcade/store.js';
import { type IPluginError, ErrArcade, ErrInvalidAddress, ErrInvalidMessageCast, ErrTxFeeBelowStateLimit } from './error.js';
import type { Config, Plugin } from './plugin.js';
import { FromAny } from './plugin.js';

export const MESSAGES: Record<string, string> = { submit_score: 'MessageSubmitScore' };
export const EVENT_TYPE_URL = 'type.googleapis.com/types.ArcadeEvent';

// 'send' is not registered, so the core handles native transfers
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const ContractConfig: any = {
    name: 'block_barrage',
    id: 1,
    version: 1,
    supportedTransactions: Object.keys(MESSAGES),
    transactionTypeUrls: Object.values(MESSAGES).map((n) => `type.googleapis.com/types.${n}`),
    eventTypeUrls: [EVENT_TYPE_URL],
    customStatePrefixes: [BARRAGE_PREFIX],
    fileDescriptorProtos
};

/** State over the plugin socket, for one in-flight FSM request. */
class PluginBackend implements Backend {
    private readonly c: Contract;
    constructor(c: Contract) {
        this.c = c;
    }
    async read(keys: Uint8Array[]): Promise<(Uint8Array | null)[]> {
        const [resp, err] = await this.c.plugin.StateRead(this.c, { keys: keys.map((key, i) => ({ queryId: Long.fromNumber(i + 1), key })) });
        if (err || resp?.error) throw new BackendError(err || resp.error);
        const out: (Uint8Array | null)[] = keys.map(() => null);
        for (const r of resp?.results || []) {
            const v = r.entries?.[0]?.value;
            out[Long.fromValue(r.queryId).toNumber() - 1] = v && v.length ? v : null;
        }
        return out;
    }
    async range(prefix: Uint8Array, limit = 0, reverse = false): Promise<Entry[]> {
        const [resp, err] = await this.c.plugin.StateRead(this.c, { ranges: [{ queryId: Long.fromNumber(1), prefix, limit: Long.fromNumber(limit), reverse }] });
        if (err || resp?.error) throw new BackendError(err || resp.error);
        return (resp?.results?.[0]?.entries || []).map((e: Entry) => ({ key: e.key, value: e.value }));
    }
    async readBatch(keys: Uint8Array[], prefixes: Uint8Array[]): Promise<[(Uint8Array | null)[], Entry[][]]> {
        return [await this.read(keys), await Promise.all(prefixes.map((p) => this.range(p)))];
    }
    async write(sets: Entry[], deletes: Uint8Array[]): Promise<void> {
        const [resp, err] = await this.c.plugin.StateWrite(this.c, { sets, deletes: deletes.map((key) => ({ key })) });
        if (err || resp?.error) throw new BackendError(err || resp.error);
    }
}

class BackendError extends Error {
    readonly pluginError: IPluginError;
    constructor(e: IPluginError) {
        super(e.msg);
        this.pluginError = e;
    }
}

export class Contract {
    Config: Config;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    FSMConfig: any;
    plugin: Plugin;
    fsmId: Long;
    /** tests swap this for a MemoryBackend */
    backend: Backend;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(config: Config, fsmConfig: any, plugin: Plugin, fsmId: Long) {
        this.Config = config;
        this.FSMConfig = fsmConfig;
        this.plugin = plugin;
        this.fsmId = fsmId;
        this.backend = new PluginBackend(this);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
    Genesis(_request: any): any {
        return {};
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
    BeginBlock(_request: any): any {
        return {};
    }
}

const bytes = (v: Uint8Array | undefined | null): Uint8Array => (v ? new Uint8Array(v) : new Uint8Array());

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function decodeTx(request: any): [Uint8Array, ScoreMsg] | IPluginError {
    const [msg, name, err] = FromAny(request.tx?.msg);
    if (err) return err;
    if (!msg || name !== 'MessageSubmitScore') return ErrInvalidMessageCast();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const m = msg as any;
    return [bytes(m.address), {
        runId: bytes(m.runId),
        initials: String(m.initials || ''),
        score: toBig(m.score),
        startHeight: toBig(m.startHeight),
        endHeight: toBig(m.endHeight),
        kills: Number(m.kills || 0),
        bestMultiplier: Number(m.bestMultiplier || 0),
        powerLevel: Number(m.powerLevel || 0)
    }];
}

function toEvents(evs: ArcadeEventOut[]): unknown[] {
    return evs.map((e) =>
        types.Event.create({
            eventType: `barrage.${e.kind}`,
            custom: { msg: { type_url: EVENT_TYPE_URL, value: types.ArcadeEvent.encode(types.ArcadeEvent.create({ kind: e.kind, data: JSON.stringify(e.data) })).finish() } },
            address: e.address
        })
    );
}

function failure(e: unknown): { error: IPluginError } {
    if (e instanceof TxError) return { error: ErrArcade(e.message) };
    if (e instanceof BackendError) return { error: e.pluginError };
    console.error('barrage: unexpected error', e);
    return { error: ErrArcade(`internal: ${(e as Error).message}`) };
}

export class ContractAsync {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    static async CheckTx(contract: Contract, request: any): Promise<any> {
        const decoded = decodeTx(request);
        if (!Array.isArray(decoded)) return { error: decoded };
        const [signer, m] = decoded;
        if (signer.length !== 20) return { error: ErrInvalidAddress() };
        const shape = checkShape(signer, m);
        if (shape) return { error: ErrArcade(shape) };
        try {
            const store = new Store(contract.backend);
            if (toBig(request.tx?.fee) < (await sendFee(store))) return { error: ErrTxFeeBelowStateLimit() };
            await precheck(store, Number(toBig(request.height)), m);
        } catch (e) {
            return failure(e);
        }
        return { authorizedSigners: [signer] };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    static async DeliverTx(contract: Contract, request: any): Promise<any> {
        const decoded = decodeTx(request);
        if (!Array.isArray(decoded)) return { error: decoded };
        const [signer, m] = decoded;
        const shape = checkShape(signer, m);
        if (shape) return { error: ErrArcade(shape) };
        const store = new Store(contract.backend);
        const events: ArcadeEventOut[] = [];
        try {
            const fee = toBig(request.tx?.fee);
            if (fee < (await sendFee(store))) throw new TxError('fee below minimum');
            await chargeFee(store, signer, contract.Config.ChainId, fee);
            await submitScore(store, Number(toBig(request.height)), signer, m, events);
            await store.flush();
        } catch (e) {
            return failure(e);
        }
        return { events: toEvents(events) };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
    static async EndBlock(_contract: Contract, _request: any): Promise<any> {
        return {};
    }
}
