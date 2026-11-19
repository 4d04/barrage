// Attacks the real server process, with a fake chain behind it. No node or browser needed.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { newKey } from '../server/chain.js';

const SECRET = 'INTERNAL-UPSTREAM-DETAIL';
const fake = { failPlugin: false, failTx: false, started: Date.now() };
const height = () => 1000 + Math.floor((Date.now() - fake.started) / 100);
let upstream, child, base, port, tmp;

const freePort = () => new Promise((resolve) => {
  const s = net.createServer().listen(0, '127.0.0.1', () => { const { port: p } = s.address(); s.close(() => resolve(p)); });
});

function fakeChain(req, res) {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    const send = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    const p = req.url.split('?')[0];
    if (p.startsWith('/barrage/')) return fake.failPlugin ? send(500, { error: SECRET }) : send(200, p.endsWith('board') ? { top: [] } : { runs: 0 });
    if (p === '/v1/query/height') return send(200, { height: height() });
    if (p === '/v1/query/block-by-height') { const { height: h } = JSON.parse(raw); return send(200, { blockHeader: { height: h, hash: 'ab'.repeat(32), time: Date.now() * 1000 } }); }
    if (p === '/v1/tx') return fake.failTx ? send(500, { error: SECRET }) : send(200, 'cd'.repeat(32));
    if (p === '/v1/query/tx-by-hash') return send(200, { height: height() - 1 });
    if (p === '/v1/query/failed-txs') return send(200, { results: [] });
    return send(404, {});
  });
}

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'barrage-test-'));
  fs.writeFileSync(path.join(tmp, 'key.json'), JSON.stringify(newKey()), { mode: 0o600 });
  upstream = http.createServer(fakeChain);
  await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
  const u = `http://127.0.0.1:${upstream.address().port}`;
  port = await freePort();
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ['server/server.js'], {
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', CANOPY_RPC: u, PLUGIN_RPC: u, ARCADE_KEY_FILE: path.join(tmp, 'key.json'), TRUST_PROXY: '1', POLL_MS: '20' },
    stdio: 'ignore',
  });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${base}/api/health`)).status === 200) return; } catch { /* starting */ }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('server did not start');
});
after(async () => {
  child.kill();
  upstream.closeAllConnections(); upstream.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

// a unique client address per test, as the proxy would report it
let nextIp = 1;
const client = () => `198.51.100.${nextIp++}`;
const from = (ip, headers = {}) => ({ 'x-forwarded-for': ip, ...headers });
const alive = async () => assert.equal(child.exitCode, null, 'server process died');

// send bytes exactly as written, because fetch() would normalize the path
function raw(requestLine, headers = 'Host: x\r\n') {
  return new Promise((resolve, reject) => {
    const s = net.connect(port, '127.0.0.1');
    let out = '';
    s.on('connect', () => s.write(`${requestLine} HTTP/1.1\r\n${headers}Connection: close\r\n\r\n`));
    s.on('data', (d) => { out += d; });
    s.on('close', () => resolve(out));
    s.on('error', reject);
    s.setTimeout(2000, () => { s.destroy(); resolve(out); });
  });
}
const statusOf = (out) => Number(out.split(' ')[1]);

test('a malformed request target cannot crash the server', async () => {
  for (const target of ['//', 'http://', '/%', '/%00', '/a%00b', '/\\..\\x']) await raw(`GET ${target}`);
  await new Promise((r) => setTimeout(r, 100));
  await alive();
  assert.equal((await fetch(`${base}/api/health`)).status, 200);
});

test('only the game files are served', async () => {
  for (const target of ['/../package.json', '/..%2fpackage.json', '/%2e%2e/server/server.js', '/../chain/.arcade-key.json', '/package.json', '/.env', '/index.html/']) {
    const out = await raw(`GET ${target}`);
    assert.equal(statusOf(out), 404, target);
    assert.doesNotMatch(out, /privateKey|"dependencies"/, target);
  }
  for (const p of ['/', '/index.html', '/game.js', '/rules.js', '/style.css']) assert.equal((await fetch(base + p)).status, 200, p);
});

test('every response carries the security headers, and the page allows no inline script', async () => {
  for (const p of ['/', '/api/health', '/nope']) {
    const h = (await fetch(base + p)).headers;
    assert.equal(h.get('x-content-type-options'), 'nosniff', p);
    assert.equal(h.get('x-frame-options'), 'DENY', p);
    assert.match(h.get('content-security-policy'), /default-src 'none'/, p);
    assert.match(h.get('content-security-policy'), /script-src 'self'(;|$)/, p);
    assert.match(h.get('content-security-policy'), /frame-ancestors 'none'/, p);
  }
  assert.doesNotMatch(await (await fetch(base)).text(), /<script(?![^>]*\bsrc=)|<style|\son\w+=/i);
});

test('other sites cannot post to the API', async () => {
  const ip = client();
  assert.equal((await fetch(`${base}/api/run`, { method: 'POST', headers: from(ip, { origin: 'https://evil.example' }) })).status, 403);
  assert.equal((await fetch(`${base}/api/score`, { method: 'POST', headers: from(ip, { origin: 'https://evil.example', 'content-type': 'application/json' }), body: '{}' })).status, 403);
  assert.equal((await fetch(`${base}/api/run`, { method: 'POST', headers: from(ip, { 'sec-fetch-site': 'cross-site' }) })).status, 403);
  assert.equal((await fetch(`${base}/api/run`, { method: 'POST', headers: from(ip, { origin: base }) })).status, 200);
  assert.equal((await fetch(`${base}/api/score`, { method: 'POST', headers: from(ip, { 'content-type': 'text/plain' }), body: '{}' })).status, 415);
  assert.equal((await fetch(`${base}/api/run`, { method: 'OPTIONS', headers: from(ip) })).headers.get('access-control-allow-origin'), null);
});

test('bad score bodies get a clean refusal', async () => {
  const post = (body) => fetch(`${base}/api/score`, { method: 'POST', headers: from(client(), { 'content-type': 'application/json' }), body });
  for (const body of ['null', '[]', '7', '"x"', '{', '{"__proto__":{"x":1}}']) {
    const r = await post(body); assert.equal(r.status, 400, body);
    assert.doesNotMatch(await r.text(), /TypeError|Cannot read|at .*\.js/, body);
  }
  assert.equal((await post(JSON.stringify({ pad: 'x'.repeat(40_000) })).catch(() => ({ status: 413 }))).status, 413);
  await alive();
});

test('a forged X-Forwarded-For cannot dodge the rate limit', async () => {
  const real = client();
  let last;
  for (let i = 0; i < 31; i++) last = await fetch(`${base}/api/run`, { method: 'POST', headers: { 'x-forwarded-for': `10.9.8.${i}, ${real}` } });
  assert.equal(last.status, 429);
});

test('one address cannot hold unlimited block feeds', async () => {
  const ip = client(), held = [];
  const open = () => new Promise((resolve, reject) => {
    const req = http.get(`${base}/api/blocks`, { headers: { 'x-forwarded-for': ip }, agent: false }, (res) => { held.push(req); res.on('error', () => {}); resolve(res.statusCode); res.resume(); });
    req.on('error', reject);
  });
  const codes = [];
  for (let i = 0; i < 21; i++) codes.push(await open());
  held.forEach((r) => r.destroy());
  assert.equal(codes.filter((c) => c === 200).length, 20);
  assert.equal(codes.at(-1), 429);
});

test('chain failures stay private', async () => {
  fake.failPlugin = true;
  await new Promise((r) => setTimeout(r, 1100)); // past the board cache
  const body = await (await fetch(`${base}/api/leaderboard`, { headers: from(client()) })).text();
  fake.failPlugin = false;
  assert.doesNotMatch(body, new RegExp(`${SECRET}|127\\.0\\.0\\.1|/barrage/`));

  const ip = client();
  const { runId, startHeight } = await (await fetch(`${base}/api/run`, { method: 'POST', headers: from(ip) })).json();
  await new Promise((r) => setTimeout(r, 500));
  fake.failTx = true;
  const r = await fetch(`${base}/api/score`, { method: 'POST', headers: from(ip, { 'content-type': 'application/json' }), body: JSON.stringify({ runId, initials: 'AAA', score: 1, endHeight: startHeight + 1, kills: 0, bestMultiplier: 1, powerLevel: 1 }) });
  fake.failTx = false;
  assert.equal(r.status, 502);
  assert.doesNotMatch(await r.text(), new RegExp(`${SECRET}|127\\.0\\.0\\.1|/v1/`));
});

test('a real run still seals, once', async () => {
  const ip = client();
  const { runId, startHeight } = await (await fetch(`${base}/api/run`, { method: 'POST', headers: from(ip, { origin: base }) })).json();
  await new Promise((r) => setTimeout(r, 500));
  const body = JSON.stringify({ runId, initials: 'ace', score: 100, endHeight: startHeight + 1, kills: 1, bestMultiplier: 1, powerLevel: 1 });
  const post = () => fetch(`${base}/api/score`, { method: 'POST', headers: from(ip, { origin: base, 'content-type': 'application/json' }), body });
  assert.equal((await post()).status, 200);
  assert.equal((await post()).status, 400, 'a run seals once');
  let s;
  for (let i = 0; i < 40; i++) { s = await (await fetch(`${base}/api/score/${runId}`, { headers: from(ip) })).json(); if (s.status !== 'pending') break; await new Promise((r) => setTimeout(r, 50)); }
  assert.equal(s.status, 'sealed');
  assert.deepEqual(Object.keys(s).sort(), ['rank', 'sealedHeight', 'status']);
});
