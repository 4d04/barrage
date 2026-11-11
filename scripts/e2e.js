// End-to-end against a running localnet and server: run -> wait blocks -> score -> sealed on chain -> board.
// Usage: node scripts/e2e.js [http://127.0.0.1:8790]
const BASE = process.argv[2] || 'http://127.0.0.1:8790';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const j = async (path, init) => { const r = await fetch(BASE + path, init); return [r.status, await r.json()]; };
const post = (path, body) => j(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });

const [, health] = await j('/api/health');
console.log('health', health);
const [, run] = await post('/api/run');
console.log('run', run);
await sleep(6000);
const [, h2] = await j('/api/health');
const endHeight = h2.tip;
const body = { runId: run.runId, initials: 'E2E', score: 4321, endHeight, kills: 9, bestMultiplier: 4, powerLevel: 3 };
const [badStatus, bad] = await post('/api/score', { ...body, score: 10 ** 12 });
console.log('impossible score ->', badStatus, bad.error);
const t0 = Date.now();
const [s, sub] = await post('/api/score', body);
console.log('submit ->', s, sub);
for (;;) {
  await sleep(100);
  const [, st] = await j(`/api/score/${run.runId}`);
  if (st.status !== 'pending') { console.log(`${st.status} after ${Date.now() - t0}ms`, st); break; }
}
const [replayStatus, replay] = await post('/api/score', body);
console.log('replayed run ->', replayStatus, replay.error);
const [, board] = await j('/api/leaderboard');
console.log('board', board.top, board.stats, `avg block ${board.avgMs}ms`);
