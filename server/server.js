// Block Barrage server (one process, two jobs):
// - watches the game chain and pushes every new block (height, hash, time) to every player over one SSE stream, so
//   the node is polled once per 100ms however many people play;
// - checks finished runs and relays each score to the chain as a submit_score tx signed by the arcade key, then
//   tells everyone when it's sealed. The leaderboard is read back from the chain (the plugin's RPC).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Chain } from './chain.js';
import { validateScore, MAX_RUN_MS } from './validate.js';
import { SECURITY_HEADERS, RateLimiter, clientIp, putBounded, sameSite } from './guard.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const env = process.env;
const PORT = Number(env.PORT || 8790);
const HOST = env.HOST || '127.0.0.1';
const POLL_MS = Number(env.POLL_MS || 100);
const TRUST_PROXY = env.TRUST_PROXY === '1';
const PUBLIC = path.join(here, '..', 'public');
// the only files this server will ever send
const STATIC = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']], ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/game.js', ['game.js', 'text/javascript; charset=utf-8']], ['/rules.js', ['rules.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
]);
const LIMITS = {
  requestsPerMinute: 1200,    // per address, everything (a sealing client polls about 7 times a second, briefly)
  runsPerMinute: 30,          // per address
  scoresPerMinute: 10,        // per address
  sseOpensPerMinute: 60,      // per address
  ssePerIp: 20,               // open block feeds per address (households and offices share one)
  sseTotal: Number(env.MAX_PLAYERS || 2000),
  sseBacklogBytes: 256 * 1024,
  sealsPerMinute: Number(env.MAX_SEALS_PER_MINUTE || 120), // all players together: each one is a transaction and permanent chain state
  pendingSeals: 500,
  runs: 100_000,              // open run tickets kept (the oldest go first)
  sealing: 20_000,
  bodyBytes: 16 * 1024,
};

const chain = new Chain({
  rpc: env.CANOPY_RPC || 'http://127.0.0.1:31002',
  pluginRpc: env.PLUGIN_RPC || 'http://127.0.0.1:31010',
  chainId: env.CHAIN_ID || 2,
  networkId: env.NETWORK_ID || 1,
  fee: BigInt(env.FEE || 10_000),
  keyFile: env.ARCADE_KEY_FILE || path.join(here, '..', 'chain', '.arcade-key.json'),
});

// ---------- chain watcher ----------
let tip = 0;            // newest committed height
let live = false;
const recent = [];      // last blocks, for the title screen and block-time stats
const clients = new Set();
const feedsByIp = new Map();

// a reader that stops reading is dropped, so its unsent data can't pile up in memory
function write(res, text) {
  if (res.writableLength > LIMITS.sseBacklogBytes) { res.destroy(); return; }
  res.write(text);
}
function send(res, event, obj) { write(res, `${event ? `event: ${event}\n` : ''}data: ${JSON.stringify(obj)}\n\n`); }
function broadcast(event, obj) { for (const res of clients) send(res, event, obj); }

async function poll() {
  try {
    const committed = (await chain.nextHeight()) - 1;
    if (!live) console.log(`chain ok at height ${committed} (${chain.rpc})`);
    live = true;
    if (committed > tip) {
      // after a gap, send at most the last 10 blocks so a player never gets a wall of invaders
      const from = tip === 0 ? committed : Math.max(tip + 1, committed - 9);
      for (let h = from; h <= committed; h++) {
        let b;
        try { b = await chain.block(h); } catch { b = { h, hash: '', t: Date.now(), txs: 0 }; }
        b.seen = Date.now();
        recent.push(b); if (recent.length > 40) recent.shift();
        broadcast(null, b);
      }
      tip = committed;
    }
  } catch (e) {
    if (live) console.warn(`chain poll failed: ${e.message}`);
    live = false;
  } finally {
    setTimeout(poll, POLL_MS);
  }
}

function blockStats() {
  const ts = recent.map((b) => b.t).filter(Boolean);
  if (ts.length < 2) return { avgMs: null };
  return { avgMs: Math.round((ts[ts.length - 1] - ts[0]) / (ts.length - 1)) };
}

// ---------- runs and scores ----------
const limiter = new RateLimiter();
const runs = new Map();     // runId -> { startHeight, startedAt }
const sealing = new Map();  // runId -> { status, txHash, submittedAt, sealedHeight?, rank?, error?, sealMs? }
setInterval(() => {
  const now = Date.now();
  limiter.sweep();
  for (const [id, r] of runs) if (now - r.startedAt > MAX_RUN_MS) runs.delete(id);
  for (const [id, s] of sealing) if (now - s.submittedAt > 3600_000) sealing.delete(id);
}, 60_000).unref();

const pendingSeals = () => { let n = 0; for (const s of sealing.values()) if (s.status === 'pending') n++; return n; };

let watching = false;
async function watchSeals() {
  if (watching) return;
  watching = true;
  try {
    while (pendingSeals() > 0) {
      const next = tip + 1;
      for (const [runId, s] of sealing) {
        if (s.status !== 'pending') continue;
        try {
          const st = await chain.txStatus(s.txHash, next);
          if (!st) {
            if (Date.now() - s.submittedAt > 30_000) Object.assign(s, { status: 'failed', error: 'not sealed within 30s' });
            continue;
          }
          let rec = null;
          try { rec = await chain.getPlugin(`/barrage/run?id=${runId}`); } catch { /* rank unknown */ }
          Object.assign(s, { status: 'sealed', sealedHeight: st.height, rank: rec?.rank ?? null, sealMs: Date.now() - s.submittedAt });
          boardCache.at = 0;
          broadcast('score', { initials: s.initials, score: s.score, rank: s.rank, height: st.height, sealMs: s.sealMs });
        } catch (e) {
          console.warn(`seal ${runId} failed: ${e.message}`);
          Object.assign(s, { status: 'failed', error: 'the chain rejected the score' });
        }
      }
      await new Promise((r) => setTimeout(r, 150));
    }
  } catch (e) {
    console.warn(`seal watcher: ${e.message}`);
  } finally {
    watching = false;
  }
}

// ---------- leaderboard (read from the chain, at most once a second however many people ask) ----------
const boardCache = { at: 0, body: { top: [], stats: null }, loading: null };
function leaderboard() {
  if (Date.now() - boardCache.at < 1000) return boardCache.body;
  boardCache.loading ??= (async () => {
    try {
      const [b, stats] = await Promise.all([chain.getPlugin('/barrage/board?limit=10'), chain.getPlugin('/barrage/stats')]);
      boardCache.body = { top: b.top, stats };
    } catch (e) {
      console.warn(`board read failed: ${e.message}`);
      boardCache.body = { top: boardCache.body.top, stats: boardCache.body.stats, error: 'board unavailable' };
    } finally {
      boardCache.at = Date.now();
      boardCache.loading = null;
    }
    return boardCache.body;
  })();
  return boardCache.loading;
}

// ---------- http ----------
class Refusal extends Error { constructor(status, message) { super(message); this.status = status; } }

function json(res, status, obj, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers });
  res.end(JSON.stringify(obj));
}
const slowDown = (res) => json(res, 429, { error: 'slow down' }, { 'retry-after': '60' });

function readBody(req) {
  return new Promise((resolve, reject) => {
    if (Number(req.headers['content-length'] || 0) > LIMITS.bodyBytes) { reject(new Refusal(413, 'too large')); return; }
    let size = 0; const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > LIMITS.bodyBytes) reject(new Refusal(413, 'too large')); else chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(new Refusal(400, 'bad json')); }
    });
    req.on('error', reject);
  });
}

function openFeed(req, res, ip) {
  const mine = feedsByIp.get(ip) || 0;
  if (!limiter.allow('sse', ip, LIMITS.sseOpensPerMinute) || mine >= LIMITS.ssePerIp) return slowDown(res);
  if (clients.size >= LIMITS.sseTotal) return json(res, 503, { error: 'the arcade is full' }, { 'retry-after': '30' });
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
  write(res, 'retry: 1000\n\n');
  send(res, 'hello', { tip, live, recent: recent.slice(-12), ...blockStats(), ranked: !!chain.key });
  clients.add(res);
  feedsByIp.set(ip, mine + 1);
  const ping = setInterval(() => write(res, ': ping\n\n'), 15_000);
  res.on('error', () => {});
  res.on('close', () => {
    clearInterval(ping);
    clients.delete(res);
    const left = (feedsByIp.get(ip) || 1) - 1;
    if (left) feedsByIp.set(ip, left); else feedsByIp.delete(ip);
  });
}

async function submitScore(req, res, ip) {
  if (!limiter.allow('score', ip, LIMITS.scoresPerMinute)) return slowDown(res);
  if (!chain.key) return json(res, 503, { error: 'scores are off: this server has no arcade key' });
  if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) return json(res, 415, { error: 'send json' });
  const body = await readBody(req);
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json(res, 400, { error: 'bad body' });
  const runId = String(body.runId ?? '');
  const v = validateScore({ run: runs.get(runId), body, tip, now: Date.now() });
  if (!v.ok) return json(res, 400, { error: v.error });
  // checked last, so junk can't use up the shared allowance; the run stays valid for a retry
  if (pendingSeals() >= LIMITS.pendingSeals || !limiter.allow('seal', 'all', LIMITS.sealsPerMinute)) {
    return json(res, 503, { error: 'the arcade is busy, try again in a moment' }, { 'retry-after': '10' });
  }
  runs.delete(runId);
  const submittedAt = Date.now();
  let txHash;
  try {
    txHash = await chain.submitScore({ runId, ...v.fields });
  } catch (e) {
    console.warn(`submit ${runId} failed: ${e.message}`);
    return json(res, 502, { error: 'the chain did not accept the score' });
  }
  putBounded(sealing, runId, { status: 'pending', txHash, submittedAt, initials: v.fields.initials, score: v.fields.score }, LIMITS.sealing);
  watchSeals();
  return json(res, 200, { runId, status: 'pending' });
}

function publicSeal(s) {
  if (s.status === 'sealed') return { status: s.status, sealedHeight: s.sealedHeight, rank: s.rank };
  return s.status === 'failed' ? { status: s.status, error: s.error } : { status: s.status };
}

async function handle(req, res) {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  const ip = clientIp(req, TRUST_PROXY);
  if (!limiter.allow('all', ip, LIMITS.requestsPerMinute)) return slowDown(res);
  let p;
  try { p = new URL(req.url, 'http://x').pathname; } catch { return json(res, 400, { error: 'bad request' }); }
  const { method } = req, read = method === 'GET' || method === 'HEAD';

  if (p.startsWith('/api/')) {
    if (method === 'POST' && !sameSite(req)) return json(res, 403, { error: 'cross-site request' });
    if (p === '/api/blocks' && method === 'GET') return openFeed(req, res, ip);
    if (p === '/api/leaderboard' && read) return json(res, 200, { ...(await leaderboard()), tip, live, ...blockStats() });
    if (p === '/api/health' && read) return json(res, live ? 200 : 503, { tip, live, players: clients.size, ranked: !!chain.key, ...blockStats() });
    if (p === '/api/run' && method === 'POST') {
      if (!limiter.allow('run', ip, LIMITS.runsPerMinute)) return slowDown(res);
      if (!live || !tip) return json(res, 503, { error: 'chain not reachable' });
      const runId = crypto.randomBytes(16).toString('hex');
      putBounded(runs, runId, { startHeight: tip, startedAt: Date.now() }, LIMITS.runs);
      return json(res, 200, { runId, startHeight: tip });
    }
    if (p === '/api/score' && method === 'POST') return await submitScore(req, res, ip);
    const m = p.match(/^\/api\/score\/([0-9a-f]{32})$/);
    if (m && read) {
      const s = sealing.get(m[1]);
      return s ? json(res, 200, publicSeal(s)) : json(res, 404, { error: 'unknown run' });
    }
    return json(res, 404, { error: 'not found' });
  }

  if (!read) return json(res, 405, { error: 'method not allowed' }, { allow: 'GET, HEAD' });
  const entry = STATIC.get(p);
  if (!entry) return json(res, 404, { error: 'not found' });
  const buf = await fs.promises.readFile(path.join(PUBLIC, entry[0]));
  res.writeHead(200, { 'content-type': entry[1], 'cache-control': 'no-cache' });
  res.end(method === 'HEAD' ? undefined : buf);
}

const server = http.createServer({ maxHeaderSize: 8 * 1024 }, (req, res) => {
  handle(req, res).catch((e) => {
    if (!(e instanceof Refusal)) console.error(`${req.method} request failed: ${e.stack || e}`);
    if (res.headersSent) { res.destroy(); return; }
    // an oversized body is abandoned, so the connection can't be reused
    json(res, e.status || 500, { error: e instanceof Refusal ? e.message : 'server error' }, e.status === 413 ? { connection: 'close' } : {});
    if (e.status === 413) res.once('finish', () => req.destroy());
  });
});
// slow or idle connections can't hold the server open; the block feed is a response, so these don't touch it
server.headersTimeout = 10_000;
server.requestTimeout = 15_000;
server.keepAliveTimeout = 65_000; // longer than the proxy's idle limit, so the proxy always closes first
server.maxConnections = LIMITS.sseTotal * 2;

process.on('unhandledRejection', (e) => console.error(`unhandled rejection: ${e?.stack || e}`));

server.listen(PORT, HOST, () => {
  console.log(`Block Barrage on http://${HOST}:${PORT}  (chain ${chain.chainId} at ${chain.rpc}, ${chain.key ? `arcade key ${chain.key.address}` : 'NO arcade key: scores off'})`);
  poll();
});
