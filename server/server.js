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
import { validateScore } from './validate.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const env = process.env;
const PORT = Number(env.PORT || 8790);
const HOST = env.HOST || '127.0.0.1';
const POLL_MS = Number(env.POLL_MS || 100);
const TRUST_PROXY = env.TRUST_PROXY === '1';
const PUBLIC = path.join(here, '..', 'public');

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

function send(res, event, obj) { res.write(`${event ? `event: ${event}\n` : ''}data: ${JSON.stringify(obj)}\n\n`); }
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
const runs = new Map();     // runId -> { startHeight, startedAt }
const sealing = new Map();  // runId -> { status, txHash, submittedAt, sealedHeight?, rank?, error?, sealMs? }
setInterval(() => {
  const now = Date.now();
  for (const [id, r] of runs) if (now - r.startedAt > 6 * 3600_000) runs.delete(id);
  for (const [id, s] of sealing) if (now - s.submittedAt > 3600_000) sealing.delete(id);
}, 60_000).unref();

let watching = false;
async function watchSeals() {
  if (watching) return;
  watching = true;
  try {
    while ([...sealing.values()].some((s) => s.status === 'pending')) {
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
          Object.assign(s, { status: 'failed', error: e.message });
        }
      }
      await new Promise((r) => setTimeout(r, 150));
    }
  } finally {
    watching = false;
  }
}

// ---------- leaderboard (read from the chain) ----------
const boardCache = { at: 0, body: { top: [], stats: null } };
async function leaderboard() {
  if (Date.now() - boardCache.at < 1000) return boardCache.body;
  try {
    const [b, stats] = await Promise.all([chain.getPlugin('/barrage/board?limit=10'), chain.getPlugin('/barrage/stats')]);
    boardCache.body = { top: b.top, stats };
    boardCache.at = Date.now();
  } catch (e) {
    boardCache.body = { ...boardCache.body, error: e.message };
  }
  return boardCache.body;
}

// ---------- rate limits (per IP, per minute) ----------
const buckets = new Map();
function allow(ip, kind, perMinute) {
  const key = `${kind}:${ip}`, now = Date.now();
  const b = buckets.get(key) || { n: 0, reset: now + 60_000 };
  if (now > b.reset) { b.n = 0; b.reset = now + 60_000; }
  b.n++; buckets.set(key, b);
  return b.n <= perMinute;
}
setInterval(() => { const now = Date.now(); for (const [k, b] of buckets) if (now > b.reset) buckets.delete(k); }, 60_000).unref();

// ---------- http ----------
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json' };

function json(res, status, obj) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function readBody(req, limit = 16 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(new Error('bad json')); } });
    req.on('error', reject);
  });
}

function clientIp(req) {
  if (TRUST_PROXY) { const f = req.headers['x-forwarded-for']; if (f) return String(f).split(',')[0].trim(); }
  return req.socket.remoteAddress || '?';
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  try {
    if (p === '/api/blocks' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
      res.write('retry: 1000\n\n');
      send(res, 'hello', { tip, live, recent: recent.slice(-12), ...blockStats(), ranked: !!chain.key });
      clients.add(res);
      const ping = setInterval(() => res.write(': ping\n\n'), 15_000);
      req.on('close', () => { clearInterval(ping); clients.delete(res); });
      return;
    }
    if (p === '/api/leaderboard' && req.method === 'GET') return json(res, 200, { ...(await leaderboard()), tip, live, ...blockStats() });
    if (p === '/api/health') return json(res, live ? 200 : 503, { tip, live, players: clients.size, ranked: !!chain.key, ...blockStats() });
    if (p === '/api/run' && req.method === 'POST') {
      if (!allow(clientIp(req), 'run', 30)) return json(res, 429, { error: 'slow down' });
      if (!live || !tip) return json(res, 503, { error: 'chain not reachable' });
      const runId = crypto.randomBytes(16).toString('hex');
      runs.set(runId, { startHeight: tip, startedAt: Date.now() });
      return json(res, 200, { runId, startHeight: tip });
    }
    if (p === '/api/score' && req.method === 'POST') {
      if (!allow(clientIp(req), 'score', 10)) return json(res, 429, { error: 'slow down' });
      if (!chain.key) return json(res, 503, { error: 'scores are off: this server has no arcade key' });
      const body = await readBody(req);
      const runId = String(body.runId || '');
      const v = validateScore({ run: runs.get(runId), body, tip, now: Date.now() });
      if (!v.ok) return json(res, 400, { error: v.error });
      runs.delete(runId);
      const submittedAt = Date.now();
      let txHash;
      try {
        txHash = await chain.submitScore({ runId, ...v.fields });
      } catch (e) {
        return json(res, 502, { error: `chain refused the score: ${e.message}` });
      }
      sealing.set(runId, { status: 'pending', txHash, submittedAt, initials: v.fields.initials, score: v.fields.score });
      watchSeals();
      return json(res, 200, { runId, txHash, status: 'pending' });
    }
    const m = p.match(/^\/api\/score\/([0-9a-f]{32})$/);
    if (m && req.method === 'GET') {
      const s = sealing.get(m[1]);
      return s ? json(res, 200, s) : json(res, 404, { error: 'unknown run' });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'method' });

    // static files from public/, no traversal
    const rel = p === '/' ? 'index.html' : decodeURIComponent(p).replace(/^\/+/, '');
    const file = path.resolve(PUBLIC, rel);
    if (!file.startsWith(PUBLIC + path.sep)) return json(res, 404, { error: 'not found' });
    fs.readFile(file, (err, buf) => {
      if (err) return json(res, 404, { error: 'not found' });
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
      res.end(req.method === 'HEAD' ? undefined : buf);
    });
  } catch (e) {
    json(res, 400, { error: e.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Block Barrage on http://${HOST}:${PORT}  (chain ${chain.chainId} at ${chain.rpc}, ${chain.key ? `arcade key ${chain.key.address}` : 'NO arcade key: scores off'})`);
  poll();
});
