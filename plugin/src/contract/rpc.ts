/* Read-only plugin RPC. Every route takes ?height= for a consistent snapshot (0 = latest committed). */

import * as http from 'http';
import Long from 'long';

import { type RunRecord, arcadeAuthority, getBoard, getStats } from '../arcade/arcade.js';
import { balance } from '../arcade/core.js';
import * as K from '../arcade/keys.js';
import { type Backend, type Entry, Store } from '../arcade/store.js';
import { Plugin, PLUGIN_BUILD } from './plugin.js';

/** Detached reads at a fixed height: not tied to any in-flight FSM request. */
class QueryBackend implements Backend {
    private readonly plugin: Plugin;
    private readonly height: number;
    constructor(plugin: Plugin, height: number) {
        this.plugin = plugin;
        this.height = height;
    }
    async read(keys: Uint8Array[]): Promise<(Uint8Array | null)[]> {
        const [resp, err] = await this.plugin.queryState(this.height, { keys: keys.map((key, i) => ({ queryId: Long.fromNumber(i + 1), key })) });
        if (err) throw new Error(err.msg);
        const out: (Uint8Array | null)[] = keys.map(() => null);
        for (const r of resp?.results || []) {
            const v = r.entries?.[0]?.value;
            out[Long.fromValue(r.queryId).toNumber() - 1] = v && v.length ? v : null;
        }
        return out;
    }
    async range(prefix: Uint8Array, limit = 0, reverse = false): Promise<Entry[]> {
        const [resp, err] = await this.plugin.queryState(this.height, { ranges: [{ queryId: Long.fromNumber(1), prefix, limit: Long.fromNumber(limit), reverse }] });
        if (err) throw new Error(err.msg);
        return resp?.results?.[0]?.entries || [];
    }
    async readBatch(keys: Uint8Array[], prefixes: Uint8Array[]): Promise<[(Uint8Array | null)[], Entry[][]]> {
        return [await this.read(keys), await Promise.all(prefixes.map((p) => this.range(p)))];
    }
    async write(): Promise<void> {
        throw new Error('read-only');
    }
}

export function StartRPCServer(plugin: Plugin): void {
    const addr = plugin.config.rpcAddress;
    if (!addr) {
        console.log('plugin RPC server disabled (no rpcAddress configured)');
        return;
    }
    const server = http.createServer((req, res) => {
        // read-only public data: any web page may read it (the browser client is served from another origin)
        res.setHeader('Access-Control-Allow-Origin', '*');
        if (req.method === 'OPTIONS') {
            res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
            res.setHeader('Access-Control-Max-Age', '600');
            res.statusCode = 204;
            res.end();
            return;
        }
        route(new Store(new QueryBackend(plugin, Number(new URL(req.url || '/', 'http://x').searchParams.get('height') || 0))), req.url || '/')
            .then(([status, body]) => writeJSON(res, status, body))
            .catch((e) => writeJSON(res, 500, { error: String((e as Error).message ?? e) }));
    });
    const idx = addr.lastIndexOf(':');
    const host = idx >= 0 ? addr.slice(0, idx) : '127.0.0.1';
    const port = idx >= 0 ? Number(addr.slice(idx + 1)) : Number(addr);
    server.listen(port, host, () => console.log(`plugin RPC server (${PLUGIN_BUILD}) listening on ${addr}`));
    server.on('error', (err) => console.log(`plugin RPC server error: ${err.message}`));
}

type Reply = [number, unknown];
const notFound: Reply = [404, { error: 'not found' }];

/** Route handling over any Store, so tests can drive it with a MemoryBackend. */
export async function route(store: Store, rawUrl: string): Promise<Reply> {
    const url = new URL(rawUrl, 'http://localhost');
    const q = (k: string) => url.searchParams.get(k);
    switch (url.pathname) {
        case '/barrage/board': {
            const limit = Math.max(1, Math.min(Number(q('limit') || 10) || 10, 100));
            return [200, { top: (await getBoard(store)).slice(0, limit) }];
        }
        case '/barrage/run': {
            const id = (q('id') || '').toLowerCase();
            if (!/^[0-9a-f]{32}$/.test(id)) return [400, { error: 'id must be 16 bytes hex' }];
            const rec = await store.getJSON<RunRecord>(K.KeyRun(new Uint8Array(Buffer.from(id, 'hex'))));
            return rec ? [200, rec] : notFound;
        }
        case '/barrage/stats':
            return [200, await getStats(store)];
        case '/barrage/arcade': {
            const auth = arcadeAuthority();
            return [200, { authority: auth ? Buffer.from(auth).toString('hex') : null, balance: auth ? (await balance(store, auth)).toString() : '0', build: PLUGIN_BUILD }];
        }
    }
    return notFound;
}

function writeJSON(res: http.ServerResponse, status: number, body: unknown): void {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(body));
}
