// Block Barrage: every Canopy block spawns an invader. 192x256 pixels, scaled up.
import { spawnFor, ENEMIES, FEATS, MAX_MULT, MAX_POWER, WEAPONS, WEAPON_NAMES, TIER_BLOCKS, tierOf } from './rules.js';

const W = 192, H = 256, TOP = 16, BOTTOM = H - 10;
const cv = document.getElementById('game');
const ctx = cv.getContext('2d');
ctx.imageSmoothingEnabled = false;
const $ = (id) => document.getElementById(id);

// ---------- palette ----------
const C = {
  bg: '#07071a', star1: '#3a3a7a', star2: '#7a7ac0', star3: '#ffffff', ink: '#000000', white: '#ffffff',
  cyan: '#5af0ff', blue: '#2a6aff', navy: '#2a2a8a', gold: '#ffd23f', orange: '#ff9a2a', red: '#ff5a5a',
  pink: '#ff6ad5', lime: '#b4f07a', green: '#3ad06a', purple: '#a86aff', grey: '#9a9cd0',
};

// ---------- 3x5 pixel font ----------
const GLYPHS = {
  '0': '111101101101111', '1': '010110010010111', '2': '111001111100111', '3': '111001111001111', '4': '101101111001001',
  '5': '111100111001111', '6': '111100111101111', '7': '111001010010010', '8': '111101111101111', '9': '111101111001111',
  A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110', E: '111100110100111',
  F: '111100110100100', G: '011100101101011', H: '101101111101101', I: '111010010010111', J: '001001001101010',
  K: '101101110101101', L: '100100100100111', M: '101111111101101', N: '110101101101101', O: '010101101101010',
  P: '110101110100100', Q: '010101101110011', R: '110101110101101', S: '011100010001110', T: '111010010010010',
  U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101', Y: '101101010010010',
  Z: '111001010100111', ' ': '000000000000000', '!': '010010010000010', '#': '101111101111101', ':': '000010000010000',
  '.': '000000000000010', '-': '000000111000000', '+': '000010111010000', '/': '001001010100100', '?': '111001010000010',
  '>': '100010001010100', '<': '001010100010001', "'": '010010000000000', ',': '000000000010100', '(': '010100100100010',
  ')': '010001001001010', '=': '000111000111000', '*': '101010101000000', '%': '101001010100101',
};
const textWidth = (s, k = 1) => String(s).length * 4 * k - k;
function drawText(s, x, y, color = C.white, k = 1, shadow = C.ink) {
  s = String(s).toUpperCase();
  for (const pass of shadow ? [0, 1] : [1]) {
    ctx.fillStyle = pass ? color : shadow;
    const o = pass ? 0 : k;
    for (let i = 0; i < s.length; i++) {
      const g = GLYPHS[s[i]] || GLYPHS['?'];
      for (let p = 0; p < 15; p++) if (g[p] === '1')
        ctx.fillRect(Math.round(x + i * 4 * k + (p % 3) * k + o), Math.round(y + Math.floor(p / 3) * k + o), k, k);
    }
  }
}
const drawTextC = (s, cx, y, color, k = 1, shadow) => drawText(s, Math.round(cx - textWidth(s, k) / 2), y, color, k, shadow);
const drawTextR = (s, rx, y, color, k = 1, shadow) => drawText(s, rx - textWidth(s, k), y, color, k, shadow);
const fmt = (n) => String(Math.floor(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

// ---------- sprites (original pixel art; one char per pixel, '.' transparent) ----------
function sprite(rows, pal) {
  const w = Math.max(...rows.map((r) => r.length));
  const make = (flash) => {
    const c = document.createElement('canvas'); c.width = w; c.height = rows.length;
    const g = c.getContext('2d');
    rows.forEach((r, y) => [...r].forEach((ch, x) => { if (pal[ch]) { g.fillStyle = flash ? '#ffffff' : pal[ch]; g.fillRect(x, y, 1, 1); } }));
    return c;
  };
  return { img: make(false), flash: make(true), w, h: rows.length };
}
const SHIP = [
  sprite(['.....w.....', '....wcw....', '....cbc....', '.w..cbc..w.', '.c.ccccc.c.', 'ccccc.ccccc', 'cc.cc.cc.cc', '...r...r...'], { w: C.white, c: C.cyan, b: C.blue, r: C.orange }),
  sprite(['.....w.....', '....wcw....', '....cbc....', '.w..cbc..w.', '.c.ccccc.c.', 'ccccc.ccccc', 'cc.cc.cc.cc', '...g...g...'], { w: C.white, c: C.cyan, b: C.blue, g: C.gold }),
];
const SPR = {
  // a one-eyed orb with trailing tendrils
  drone: [
    sprite(['...gggg...', '..gggggg..', '.ggwwwggg.', '.ggwkwggg.', '.gggggggg.', '..gggggg..', '.g..gg..g.', 'g...g..g..'], { g: C.green, w: C.white, k: C.ink }),
    sprite(['...gggg...', '..gggggg..', '.ggwwwggg.', '.ggwkwggg.', '.gggggggg.', '..gggggg..', '..g.gg.g..', '..g..g...g'], { g: C.green, w: C.white, k: C.ink }),
  ],
  // a swept-wing dart
  zigzag: [
    sprite(['y........y', 'yy..oo..yy', '.yyyooyyy.', '..yywwyy..', '...ykky...', '..yy..yy..', '.y......y.', '..........'], { y: C.gold, o: C.orange, w: C.white, k: C.ink }),
    sprite(['..........', 'y...oo...y', 'yyyyooyyyy', '..yywwyy..', '...ykky...', '...y..y...', '..y....y..', '..........'], { y: C.gold, o: C.orange, w: C.white, k: C.ink }),
  ],
  // a turret pod with a barrel underneath
  gunner: [
    sprite(['...rrrrr...', '..rrrrrrr..', '.rrwkrwkrr.', '.rrwwrwwrr.', 'rrrrrrrrrrr', 'r.rrdddrr.r', 'r...ddd...r', '.....d.....', '.....d.....'], { r: C.red, w: C.white, k: C.ink, d: C.grey }),
  ],
  // two halves held together
  splitter: [
    sprite(['.ppp...ppp.', 'ppppp.ppppp', 'ppwkp.pwkpp', 'ppppplppppp', '.pppplpppp.', '..ppplppp..', '.pp.....pp.', 'p.........p', '...........'], { p: C.purple, w: C.white, k: C.ink, l: C.pink }),
    sprite(['.ppp...ppp.', 'ppppp.ppppp', 'ppwkp.pwkpp', 'ppppplppppp', '.pppplpppp.', '..ppplppp..', '..pp...pp..', '..p.....p..', '...........'], { p: C.purple, w: C.white, k: C.ink, l: C.pink }),
  ],
  mini: [sprite(['.pp.', 'pwkp', 'pppp', 'p..p'].map((r) => '.' + r + '.'), { p: C.pink, w: C.white, k: C.ink })],
  // an armoured crawler
  tank: [
    sprite(['....ooooooo....', '..ooyyyyyyyoo..', '.oyyyyyyyyyyyo.', 'oyyokkoyokkoyyo', 'oyyokwoyokwoyyo', 'oyyyyyyyyyyyyyo', 'ooooooooooooooo', 'o.o.o.o.o.o.o.o', '.o.o.o.o.o.o.o.', '......ddd......', '.......d.......'], { o: C.orange, y: C.gold, k: C.ink, w: C.white, d: C.grey }),
  ],
  // an arrowhead that dives
  diver: [
    sprite(['c.......c', 'cc.....cc', 'ccc...ccc', '.cccwccc.', '.ccwkwcc.', '..ccccc..', '...ccc...', '...bcb...', '....b....'], { c: C.cyan, w: C.white, k: C.ink, b: C.blue }),
  ],
  // a ribbed jelly that sways and sprays
  weaver: [
    sprite(['....ppppp....', '..ppwwpwwpp..', '.ppwkkpkkwpp.', 'ppppppppppppp', 'pLpLpLpLpLpLp', '.p.p.p.p.p.p.', '.p..p.p.p..p.', 'p...p...p...p', '...p.....p...'], { p: C.pink, w: C.white, k: C.ink, L: C.purple }),
    sprite(['....ppppp....', '..ppwwpwwpp..', '.ppwkkpkkwpp.', 'ppppppppppppp', 'pLpLpLpLpLpLp', '.p.p.p.p.p.p.', '..p.p...p.p..', '..p..p.p..p..', '.p.........p.'], { p: C.pink, w: C.white, k: C.ink, L: C.purple }),
  ],
};
// the Blockmonster, drawn procedurally: a living block with big eyes, teeth and stomping feet
SPR.blockmonster = [0, 1].map((f) => {
  const rows = [];
  for (let y = 0; y < 18; y++) {
    let r = '';
    for (let x = 0; x < 26; x++) {
      let ch = '.';
      const body = x >= 3 && x <= 22 && y >= 1 && y <= 13;
      if (body) ch = x === 3 || x === 22 || y === 1 || y === 13 ? 'o' : (x + y) % 6 === 0 ? 'l' : 'p';
      if (y === 0 && (x === 6 || x === 7 || x === 18 || x === 19)) ch = 'o'; // horns
      if ((x === 1 || x === 2 || x === 23 || x === 24) && y === (f ? 6 : 8)) ch = 'o'; // arms
      if ((x >= 6 && x <= 10 || x >= 15 && x <= 19) && y >= 3 && y <= 7) ch = 'w';
      const look = f ? 1 : 0;
      if ((x === 8 + look || x === 17 + look) && (y === 5 || y === 6)) ch = 'k';
      if (y >= 10 && y <= 11 && x >= 6 && x <= 19) ch = (x + y) % 2 ? 'w' : 'k';
      const step = f ? [5, 6, 17, 18] : [7, 8, 19, 20];
      if (y >= 14 && step.includes(x)) ch = y === 17 ? 'k' : 'o';
      r += ch;
    }
    rows.push(r);
  }
  return sprite(rows, { o: C.purple, p: C.pink, l: C.purple, w: C.white, k: C.ink });
});
// the century mothership, drawn procedurally: a gold saucer with a row of lights that read "00"
SPR.century = [0, 1].map((f) => {
  const rows = [];
  for (let y = 0; y < 14; y++) {
    let r = '';
    for (let x = 0; x < 32; x++) {
      const dx = (x - 15.5) / 16;
      const dome = y < 5 && Math.abs(x - 15.5) < 6 - y * 0.6 + 2;
      const hull = y >= 4 && y <= 10 && dx * dx + ((y - 7) / 3.6) ** 2 < 1;
      const legs = y >= 11 && (x % 8 === 3 || x % 8 === 4) && x > 2 && x < 29;
      let ch = '.';
      if (dome) ch = y < 2 ? 'w' : 'c';
      if (hull) ch = y === 7 ? (((x + f * 2) % 4 < 2) ? 'r' : 'y') : y < 7 ? 'y' : 'o';
      if (legs) ch = 'o';
      if (hull && y === 6 && (x === 12 || x === 13 || x === 18 || x === 19)) ch = 'k';
      r += ch;
    }
    rows.push(r);
  }
  return sprite(rows, { w: C.white, c: C.cyan, y: C.gold, o: C.orange, r: C.red, k: C.ink });
});
const PICK = {
  P: { color: C.gold, label: 'P' }, R: { color: C.lime, label: 'R' }, S: { color: C.cyan, label: 'S' },
  N: { color: C.orange, label: 'N' }, H: { color: C.pink, label: 'H' },
};

// ---------- sound (square-wave beeps and noise) ----------
let actx = null, muted = false, noiseBuf = null;
try { muted = localStorage.getItem('barrage.muted') === '1'; } catch {}
function audio() {
  if (actx) return;
  try {
    actx = new (window.AudioContext || window.webkitAudioContext)();
    noiseBuf = actx.createBuffer(1, actx.sampleRate * 0.4, actx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  } catch { actx = null; }
}
function beep(f0, f1, dur, type = 'square', vol = 0.05, delay = 0) {
  if (muted || !actx) return;
  const t = actx.currentTime + delay, o = actx.createOscillator(), g = actx.createGain();
  o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(actx.destination); o.start(t); o.stop(t + dur + 0.02);
}
function noise(dur, vol = 0.08, cutoff = 1800) {
  if (muted || !actx) return;
  const t = actx.currentTime, s = actx.createBufferSource(), f = actx.createBiquadFilter(), g = actx.createGain();
  s.buffer = noiseBuf; f.type = 'lowpass'; f.frequency.setValueAtTime(cutoff, t); f.frequency.exponentialRampToValueAtTime(120, t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(actx.destination); s.start(t); s.stop(t + dur);
}
let lastShotSfx = 0;
const SFX = {
  shot: () => { const n = performance.now(); if (n - lastShotSfx > 90) { lastShotSfx = n; beep(1400, 500, 0.04, 'square', 0.012); } },
  hit: () => beep(300, 200, 0.03, 'square', 0.02),
  pop: (big) => noise(big ? 0.5 : 0.18, big ? 0.14 : 0.06, big ? 2600 : 1800),
  pick: () => { beep(660, 990, 0.06, 'square', 0.04); beep(990, 1320, 0.07, 'square', 0.04, 0.06); },
  feat: (n = 0) => { beep(520 + n * 50, 1040 + n * 70, 0.08, 'square', 0.04); beep(780 + n * 50, 1560, 0.09, 'square', 0.04, 0.07); },
  milestone: () => [523, 659, 784, 1047].forEach((f, i) => beep(f, f * 1.01, 0.1, 'square', 0.05, i * 0.08)),
  hurt: () => { noise(0.4, 0.12, 900); beep(400, 60, 0.4, 'sawtooth', 0.05); },
  bomb: () => { noise(0.9, 0.18, 3000); beep(120, 40, 0.8, 'square', 0.06); },
  block: () => beep(2200, 2100, 0.012, 'square', 0.006),
  over: () => [392, 330, 262, 196].forEach((f, i) => beep(f, f * 0.98, 0.22, 'square', 0.05, i * 0.2)),
  tier: () => [262, 392, 523].forEach((f, i) => beep(f, f, 0.08, 'triangle', 0.06, i * 0.09)),
};
$('mute').textContent = muted ? 'SOUND OFF' : 'SOUND ON';
function toggleMute() { muted = !muted; try { localStorage.setItem('barrage.muted', muted ? '1' : '0'); } catch {} $('mute').textContent = muted ? 'SOUND OFF' : 'SOUND ON'; }
$('mute').addEventListener('click', (e) => { e.stopPropagation(); audio(); toggleMute(); });

// ---------- block feed (server-sent events; practice blocks if the chain can't be reached) ----------
const feed = { tip: 0, live: false, ranked: false, lastAt: 0, intervals: [], sim: null, hashes: new Map() };
function onBlock(b, local = false) {
  if (b.h <= feed.tip) return;
  const now = performance.now();
  if (b.h === feed.tip + 1) {
    const iv = b.t && feed.lastT ? b.t - feed.lastT : feed.lastAt ? now - feed.lastAt : 0;
    if (iv > 0) { feed.intervals.push(iv); if (feed.intervals.length > 20) feed.intervals.shift(); }
  }
  feed.tip = b.h; feed.lastAt = now; feed.lastT = b.t || 0;
  railPush(b, local);
  gameBlock(b, local);
}
function startSim() {
  if (feed.sim) return;
  feed.live = false; setMode();
  if (!feed.tip) feed.tip = 1000;
  feed.sim = setInterval(() => onBlock({ h: feed.tip + 1, hash: null, t: Date.now() }, true), 500);
}
function stopSim() { clearInterval(feed.sim); feed.sim = null; }
function connectFeed() {
  let es;
  try { es = new EventSource('/api/blocks'); } catch { startSim(); return; }
  es.addEventListener('hello', (ev) => {
    const m = JSON.parse(ev.data);
    feed.ranked = !!m.ranked;
    if (m.live && m.tip) { stopSim(); feed.live = true; if (m.tip > feed.tip) { feed.tip = m.tip; feed.lastAt = performance.now(); feed.lastT = m.recent?.at(-1)?.t || 0; } for (const b of m.recent || []) railPush(b, false); }
    setMode();
  });
  es.onmessage = (ev) => {
    const b = JSON.parse(ev.data);
    if (!feed.live) { stopSim(); feed.live = true; setMode(); }
    onBlock(b);
  };
  es.addEventListener('score', (ev) => {
    const s = JSON.parse(ev.data);
    addFeed(`${s.initials} ${fmt(s.score)} sealed in #${s.height}`);
    loadBoard();
    if (state === 'play') toast(`${s.initials} SEALED ${fmt(s.score)}`);
  });
  setTimeout(() => { if (!feed.live) startSim(); }, 3000);
  // if the feed goes quiet for 4s, keep the game playable on practice blocks
  setInterval(() => { if (feed.live && performance.now() - feed.lastAt > 4000) startSim(); }, 1000);
}
function avgBlockMs() { const iv = feed.intervals; return iv.length ? iv.reduce((a, b) => a + b, 0) / iv.length : 0; }

// ---------- side panel ----------
const RAIL_N = 14;
// a cursor sweeps left to right, one cell per block, and wraps back to the left when it reaches the end
let railPos = -1;
function railPush(b) {
  $('tip').textContent = `#${fmt(b.h)}`;
  const avg = avgBlockMs();
  if (avg) { $('avgms').textContent = `${Math.round(avg)}ms`; $('hdrms').textContent = `${Math.round(avg)}ms`; }
  const rail = $('rail');
  if (rail.children.length !== RAIL_N) { rail.textContent = ''; for (let k = 0; k < RAIL_N; k++) rail.appendChild(document.createElement('i')); }
  railPos = (railPos + 1) % RAIL_N;
  const cells = rail.children;
  if (railPos === 0) for (const c of cells) c.className = '';
  else cells[railPos - 1].className = 'on';
  const i = cells[railPos];
  i.className = 'new'; i.title = `#${b.h}${b.hash ? ' ' + b.hash.slice(0, 12) : ''}`;
}
function setMode() {
  $('mode').textContent = feed.live ? 'live' : 'practice blocks';
  $('modeNote').textContent = feed.live ? (feed.ranked ? '' : 'Scores are off on this server (no arcade key).') : "Can't reach the chain: practice mode, scores aren't sealed.";
}
function addFeed(text) {
  const f = $('feed'), d = document.createElement('div'); d.textContent = text;
  f.prepend(d); while (f.children.length > 4) f.lastChild.remove();
}
let myRun = null;
async function loadBoard() {
  try {
    const r = await fetch('/api/leaderboard'); const j = await r.json();
    const ol = $('board'); ol.innerHTML = '';
    hiScore = Math.max(hiScore, j.top?.[0]?.score || 0);
    if (!j.top?.length) { ol.innerHTML = `<li class="empty">${j.error ? "Can't read the board from the chain right now." : 'No scores sealed yet. Be the first.'}</li>`; return; }
    j.top.forEach((e, i) => {
      const li = document.createElement('li');
      if (myRun && e.run === myRun) li.className = 'me';
      li.innerHTML = `<span>${i + 1}.</span><span></span><span class="s"></span>`;
      li.children[1].textContent = e.initials; li.children[2].textContent = fmt(e.score);
      li.title = `x${e.bestMultiplier} best, ${e.kills} kills, sealed in block #${e.sealedHeight}`;
      ol.appendChild(li);
    });
  } catch { /* keep the old board */ }
}

// ---------- input ----------
const keys = { left: false, right: false, up: false, down: false };
const KEYMAP = { ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down' };
let pointer = null; // { x, y } in game pixels when the mouse or a finger steers
window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  if (KEYMAP[e.code]) { keys[KEYMAP[e.code]] = true; pointer = null; e.preventDefault(); }
  if (e.code === 'Space' || e.code === 'KeyX' || e.code === 'KeyB') { e.preventDefault(); if (state === 'play') bomb(); else if (state === 'title') start(); }
  if (e.code === 'Enter' && state === 'title') start();
  if (e.code === 'KeyP' || e.code === 'Escape') togglePause();
  if (e.code === 'KeyM') toggleMute();
});
window.addEventListener('keyup', (e) => { if (KEYMAP[e.code]) keys[KEYMAP[e.code]] = false; });
function toGame(e) {
  const r = cv.getBoundingClientRect();
  return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
}
let touchStart = null;
cv.addEventListener('pointermove', (e) => {
  if (state !== 'play') return;
  if (e.pointerType === 'mouse') pointer = toGame(e);
  else if (touchStart) {
    // a finger steers by dragging, so it never covers the ship
    const p = toGame(e);
    pointer = { x: touchStart.sx + (p.x - touchStart.px) * 1.3, y: touchStart.sy + (p.y - touchStart.py) * 1.3 };
  }
});
cv.addEventListener('pointerdown', (e) => {
  audio();
  if (state !== 'play') return;
  if (e.pointerType === 'mouse' && e.button === 2) { bomb(); return; }
  if (e.pointerType !== 'mouse') { const p = toGame(e); touchStart = { px: p.x, py: p.y, sx: player.x, sy: player.y }; cv.setPointerCapture(e.pointerId); }
});
cv.addEventListener('pointerup', () => { touchStart = null; });
cv.addEventListener('contextmenu', (e) => e.preventDefault());
$('bombBtn').addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); if (state === 'play') bomb(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'play' && !paused) togglePause(); });

// ---------- game state ----------
let state = 'title', paused = false, clock = 0, shake = 0, flash = 0, flashColor = C.white, hiScore = 0;
let player, enemies, bullets, ebullets, pickups, particles, popups, banners, beams, toasts, nukes, blasts, run;
const stars = Array.from({ length: 70 }, (_, i) => ({ x: Math.random() * W, y: Math.random() * H, z: 1 + (i % 3) }));

function reset() {
  player = { x: W / 2, y: BOTTOM - 14, lives: 3, power: 1, bombs: 1, shield: 0, rapid: 0, invuln: 0, fireCd: 0, missileCd: 0 };
  enemies = []; bullets = []; ebullets = []; pickups = []; particles = []; popups = []; banners = []; beams = []; toasts = []; nukes = []; blasts = [];
  run = {
    id: null, startHeight: feed.tip, lastHeight: feed.tip, practice: !feed.live, score: 0, kills: 0,
    mult: 1, charge: 0, bestMult: 1, blocksSinceKill: 0, combo: 0, burstAt: -1, burst: 0, cleanBlocks: 0, milestone: 0,
    tier: 0, startedAt: Date.now(), bestPower: 1,
  };
}
reset();

async function start() {
  if (state === 'play') return;
  audio();
  reset();
  state = 'play'; paused = false;
  $('title').hidden = true; $('over').hidden = true;
  // the Blockmonster: born from the block this run starts on, already on screen
  const h0 = feed.tip || 0, m = ENEMIES.blockmonster;
  spawn({ type: 'blockmonster', height: h0, tier: 0, hp: m.hp, x: 0.5, speed: 1, pts: m.pts, drop: 'P', dir: h0 % 2 ? 1 : -1, phase: 0.4, hash: null });
  banner('BLOCKMONSTER', 'TAKE IT DOWN', C.pink, 2.2);
  banner('WAVE 1', 'DRONES AND ZIGZAGS', C.cyan);
  if (feed.live && feed.ranked) {
    try {
      const r = await fetch('/api/run', { method: 'POST' });
      const j = await r.json();
      if (r.ok && state === 'play') { run.id = j.runId; run.startHeight = j.startHeight; }
      else run.practice = true;
    } catch { run.practice = true; }
  } else run.practice = true;
}
$('title').addEventListener('click', start);

function togglePause() {
  if (state !== 'play') return;
  paused = !paused;
}

// ---------- spawning: one invader per block ----------
const UNLOCK_TEXT = ['DRONES AND ZIGZAGS', 'GUNNERS INBOUND', 'SPLITTERS INBOUND', 'TANKS INBOUND', 'DIVERS INBOUND', 'WEAVERS INBOUND'];
function gameBlock(b) {
  if (state !== 'play') return;
  if (b.h <= run.lastHeight) return;
  run.lastHeight = b.h;
  if (paused) return;
  SFX.block();
  const n = b.h - run.startHeight;
  const tier = tierOf(n);
  if (tier > run.tier) {
    run.tier = tier;
    banner(`WAVE ${tier + 1}`, UNLOCK_TEXT[tier] || 'FASTER. MEANER.', tier < UNLOCK_TEXT.length ? C.cyan : C.pink);
    SFX.tier();
  }
  spawn(spawnFor(b.h, b.hash, n));
  // the multiplier cools by the chain's clock: four blocks without a kill halves it
  run.blocksSinceKill++;
  if (run.blocksSinceKill >= 4 && run.mult > 1) {
    const was = run.mult;
    run.mult = Math.max(1, Math.floor(run.mult / 2));
    run.blocksSinceKill = 0; run.combo = 0; run.charge = 0;
    if (run.mult < 4) run.milestone = 0;
    popup(`X${was} > X${run.mult}`, player.x, player.y - 12, C.grey);
  }
  run.cleanBlocks++;
  if (run.cleanBlocks % 40 === 0) feat('UNBROKEN CHAIN', FEATS.unbroken, CHARGE.unbroken, player.x, player.y - 16);
}

function spawn(s) {
  const def = ENEMIES[s.type];
  const boss = isBoss(s);
  const x = boss ? W / 2 : Math.round(s.x * (W - def.w)) + def.w / 2;
  const y = boss ? TOP + 14 : TOP + 8 + Math.round(s.phase * 50);
  const e = {
    ...s, x, y, w: def.w, h: def.h, maxHp: s.hp, t: 0, flash: 0, vx: 0, vy: 0, fireCd: 1 + s.phase * 1.5,
    state: 0, anchorX: x, born: clock, label: String(s.height).slice(-4),
  };
  if (s.type === 'zigzag') e.vx = 46 * s.speed * s.dir;
  if (s.type === 'century') { e.vx = 30 * s.dir; e.life = 40; banner('CENTURY BLOCK', `#${s.height}`, C.gold); SFX.milestone(); }
  if (s.type === 'blockmonster') { e.vx = 22 * s.dir; e.fireCd = 2.2; e.volley = 0; SFX.milestone(); }
  enemies.push(e);
  beams.push({ x, y, t: 0.12 });
}

// ---------- effects ----------
function popup(text, x, y, color = C.white, k = 1) { popups.push({ text, x, y, color, k, t: 0, life: 0.9 }); }
function banner(text, sub, color = C.gold, life = 1.6) { banners.push({ text, sub, color, t: 0, life }); }
function toast(text) { toasts.push({ text, t: 0, life: 2.5 }); }
function burst(x, y, color, n = 10, speed = 60) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, v = speed * (0.3 + Math.random());
    particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: 0, life: 0.3 + Math.random() * 0.4, color });
  }
}

// ---------- the multiplier ----------
// Feats add charge; when the charge fills, the multiplier steps up. Each step needs 2 x (current multiplier) charge,
// so x4 comes quickly and x32 takes minutes of near-perfect play.
const MILESTONES = [[32, 'MAX FINALITY!', C.pink], [16, '500MS MADNESS!', C.lime], [8, 'ON FIRE!', C.orange], [4, 'NICE!', C.cyan]];
const CHARGE = { finality: 1, double: 1, triple: 2, mega: 3, combo: 2, unbroken: 4, century: 8 };
const need = (m) => 2 * m;
function charge(c) {
  if (!c) return;
  run.charge += c;
  while (run.mult < MAX_MULT && run.charge >= need(run.mult)) {
    run.charge -= need(run.mult);
    const was = run.mult;
    run.mult++;
    run.bestMult = Math.max(run.bestMult, run.mult);
    let hit = false;
    for (const [level, text, color] of MILESTONES) {
      if (was < level && run.mult >= level && run.milestone < level) {
        run.milestone = level; hit = true;
        banner(text, `X${level} MULTIPLIER`, color, 1.8);
        flash = 0.25; flashColor = color; shake = Math.max(shake, 4);
        SFX.milestone();
        break;
      }
    }
    if (!hit) { popup(`X${run.mult}!`, player.x, player.y - 22, C.gold); SFX.feat(Math.min(run.mult, 12)); }
  }
  if (run.mult >= MAX_MULT) run.charge = 0;
}
function feat(text, bonus, c, x, y, color = C.gold) {
  charge(c);
  run.score += bonus * run.mult;
  popup(text, x, y, color);
  SFX.feat(Math.min(run.mult, 12));
}

function kill(e) {
  e.dead = true;
  run.kills++;
  run.blocksSinceKill = 0;
  // FINALITY: it dies before the next block lands (the block that spawned it is still the newest one)
  if (e.height === run.lastHeight && e.type !== 'mini') feat('FINALITY!', FEATS.finality, CHARGE.finality, e.x, e.y - 10, C.cyan);
  // several kills inside 150ms
  if (clock - run.burstAt < 0.15) run.burst++; else { run.burstAt = clock; run.burst = 1; }
  if (run.burst === 2) feat('DOUBLE', FEATS.double, CHARGE.double, e.x, e.y + 2, C.lime);
  else if (run.burst === 3) feat('TRIPLE', FEATS.triple, CHARGE.triple, e.x, e.y + 2, C.lime);
  else if (run.burst === 5) feat('MEGA KILL', FEATS.mega, CHARGE.mega, e.x, e.y + 2, C.pink);
  run.combo++;
  if (run.combo % 8 === 0) feat(`COMBO ${run.combo}`, FEATS.combo, CHARGE.combo, e.x, e.y + 8, C.orange);
  if (e.type === 'blockmonster') {
    feat('BLOCKMONSTER DOWN!', FEATS.blockmonster, CHARGE.century, e.x, e.y + 12, C.pink);
    banner('MONSTER DOWN', `BLOCK #${e.height}`, C.pink);
    shake = 8; flash = 0.3; flashColor = C.pink;
  }
  if (e.type === 'century') {
    feat('CENTURY DOWN!', FEATS.century, CHARGE.century, e.x, e.y + 12, C.gold);
    banner('CENTURY DOWN', `BLOCK #${e.height}`, C.gold);
    shake = 8; flash = 0.3; flashColor = C.gold;
  }
  const pts = e.pts * run.mult;
  run.score += pts;
  popup(fmt(pts), e.x, e.y, C.white);
  burst(e.x, e.y, colorOf(e), isBoss(e) ? 50 : 12, isBoss(e) ? 110 : 60);
  SFX.pop(isBoss(e) || e.type === 'tank');
  if (e.type === 'splitter') {
    for (const d of [-1, 1]) enemies.push({ ...e, type: 'mini', dead: false, hp: 1, maxHp: 1, w: 6, h: 5, pts: ENEMIES.mini.pts * (1 + e.tier), vx: 40 * d, vy: 30, drop: null, x: e.x + d * 3, t: 0, flash: 0 });
  }
  if (e.drop) pickups.push({ kind: e.drop, x: e.x, y: e.y, t: 0 });
  if (e.type === 'century') pickups.push({ kind: 'H', x: e.x + 8, y: e.y, t: 0 });
}
const ENEMY_COLOR = { drone: C.green, zigzag: C.gold, gunner: C.red, splitter: C.purple, mini: C.pink, tank: C.orange, diver: C.cyan, weaver: C.pink, century: C.gold, blockmonster: C.pink };
function isBoss(e) { return e.type === 'century' || e.type === 'blockmonster'; }
const colorOf = (e) => ENEMY_COLOR[e.type] || C.white;

function damage(e, dmg) {
  if (e.dead) return;
  e.hp -= dmg; e.flash = 0.06;
  if (e.hp <= 0) kill(e); else SFX.hit();
}

function hurt(reason) {
  if (player.invuln > 0) return;
  if (player.shield > 0) {
    player.shield = 0; player.invuln = 0.8;
    popup('SHIELD!', player.x, player.y - 10, C.cyan); SFX.hit(); burst(player.x, player.y, C.cyan, 14, 50);
    return;
  }
  player.lives--; player.invuln = 1.6;
  if (reason !== 'breach') player.power = Math.max(1, player.power - 1);
  if (run.mult > 1) popup('CHAIN BROKEN', player.x, player.y - 14, C.red);
  run.mult = 1; run.charge = 0; run.combo = 0; run.cleanBlocks = 0; run.milestone = 0;
  shake = 6; flash = 0.2; flashColor = C.red;
  SFX.hurt(); burst(player.x, player.y, C.cyan, 24, 80);
  if (player.lives <= 0) gameOver();
}

// The bomb is a heat-seeking nuke: it locks onto the toughest invader on screen, chases it, and detonates on
// contact (or when its fuel runs out), wrecking everything inside the blast and erasing nearby enemy fire.
const NUKE = { speed: 210, turn: 5, fuel: 2.2, radius: 38, dmg: 14, wipe: 52 };
function nukeTarget(n) {
  let best = null, score = -1e9;
  for (const e of enemies) {
    if (e.dead || e.y < TOP - 4) continue;
    const s = e.hp * 10 + (isBoss(e) ? 1000 : 0) - Math.hypot(e.x - n.x, e.y - n.y) * 0.2;
    if (s > score) { score = s; best = e; }
  }
  return best;
}
function bomb() {
  if (paused || player.bombs <= 0) return;
  player.bombs--;
  const n = { x: player.x, y: player.y - 6, vx: 0, vy: -90, t: 0, target: null };
  n.target = nukeTarget(n);
  nukes.push(n);
  SFX.bomb(); shake = 2;
  popup('NUKE AWAY', player.x, player.y - 12, C.orange);
}
function detonate(n) {
  n.spent = true;
  // the main fireball, then a few smaller pops scattered inside the blast
  blasts.push({ x: n.x, y: n.y, t: 0, life: 1.1, r: NUKE.radius, seed: Math.random() * 1000, main: true });
  for (let k = 0; k < 5; k++) {
    const a = Math.random() * Math.PI * 2, d = NUKE.radius * (0.35 + Math.random() * 0.5);
    blasts.push({ x: n.x + Math.cos(a) * d, y: n.y + Math.sin(a) * d, t: -0.06 - k * 0.06, life: 0.5, r: 9 + Math.random() * 6, seed: Math.random() * 1000 });
  }
  flash = 0.35; flashColor = C.white; shake = 10;
  SFX.bomb(); setTimeout(() => SFX.bomb(), 90);
  burst(n.x, n.y, C.white, 20, 160); burst(n.x, n.y, C.gold, 36, 120); burst(n.x, n.y, C.orange, 36, 90); burst(n.x, n.y, C.red, 20, 60);
  // smoke that drifts up after the fire burns out
  for (let k = 0; k < 18; k++) {
    const a = Math.random() * Math.PI * 2, d = Math.random() * NUKE.radius * 0.7;
    particles.push({ x: n.x + Math.cos(a) * d, y: n.y + Math.sin(a) * d, vx: (Math.random() - 0.5) * 12, vy: -10 - Math.random() * 14, t: 0, life: 0.9 + Math.random() * 0.8, color: Math.random() < 0.5 ? C.navy : C.grey });
  }
  ebullets = ebullets.filter((b) => Math.hypot(b.x - n.x, b.y - n.y) > NUKE.wipe);
  for (const e of enemies) {
    if (e.dead) continue;
    // a hit anywhere on the body counts, so big invaders aren't safe just because their middle is far away
    const dx = Math.max(0, Math.abs(e.x - n.x) - e.w / 2), dy = Math.max(0, Math.abs(e.y - n.y) - e.h / 2);
    if (Math.hypot(dx, dy) <= NUKE.radius) damage(e, NUKE.dmg);
  }
}
function updateNukes(dt) {
  for (const n of nukes) {
    n.t += dt;
    if (!n.target || n.target.dead) n.target = nukeTarget(n);
    const speed = NUKE.speed * Math.min(1, 0.4 + n.t * 2); // a slow launch, then it opens up
    if (n.target) {
      const a = Math.atan2(n.target.y - n.y, n.target.x - n.x);
      const k = Math.min(1, NUKE.turn * dt);
      n.vx += (Math.cos(a) * speed - n.vx) * k; n.vy += (Math.sin(a) * speed - n.vy) * k;
    } else { n.vx *= 1 - 2 * dt; n.vy += (-speed - n.vy) * Math.min(1, 3 * dt); }
    n.x += n.vx * dt; n.y += n.vy * dt;
    // exhaust
    if (Math.random() < 0.9) particles.push({ x: n.x - n.vx * 0.03, y: n.y - n.vy * 0.03, vx: (Math.random() - 0.5) * 20, vy: (Math.random() - 0.5) * 20, t: 0, life: 0.35, color: Math.random() < 0.5 ? C.gold : C.navy });
    const hit = enemies.some((e) => !e.dead && Math.abs(e.x - n.x) < e.w / 2 + 2 && Math.abs(e.y - n.y) < e.h / 2 + 2);
    if (hit || n.t > NUKE.fuel || n.y < TOP + 4 || n.x < 2 || n.x > W - 2) detonate(n);
  }
  nukes = nukes.filter((n) => !n.spent);
  for (const b of blasts) b.t += dt;
  blasts = blasts.filter((b) => b.t < b.life);
}
// cheap per-pixel noise, so the fireball's edge boils instead of being a clean circle
const boil = (x, y, s) => { const v = Math.sin(x * 12.9898 + y * 78.233 + s) * 43758.5453; return v - Math.floor(v); };
const FIRE = [C.white, '#fff6b0', C.gold, C.orange, C.red, '#8a2a4a'];
function drawBlast(b) {
  const k = b.t / b.life;
  // grows fast, then burns down from the outside in
  const r = b.r * (k < 0.25 ? 0.4 + 2.4 * k : 1 - 0.55 * (k - 0.25));
  const heat = k * 1.6; // 0 white-hot, later cooling to red
  const flick = Math.floor(clock * 20);
  for (let y = -r; y <= r; y += 2) {
    for (let x = -r; x <= r; x += 2) {
      const d = Math.hypot(x, y) / r, n = boil(Math.round(x / 2), Math.round(y / 2), b.seed + flick);
      if (d + n * 0.35 > 1.05) continue;
      // hotter in the middle, cooler at the rim and with age
      const i = Math.min(FIRE.length - 1, Math.max(0, Math.floor((d * 2.2 + heat * 2.6 + n * 0.8))));
      if (k > 0.6 && n < (k - 0.6) * 2.2) continue; // it breaks up as it dies
      ctx.fillStyle = FIRE[i];
      ctx.fillRect(Math.round(b.x + x), Math.round(b.y + y), 2, 2);
    }
  }
  if (b.main) {
    // the shockwave runs out past the fireball, and a white core flash at the very start
    const sr = b.r * (0.5 + k * 1.6);
    ctx.globalAlpha = Math.max(0, 1 - k * 1.4);
    ctx.lineWidth = 2; ctx.strokeStyle = C.white; ctx.beginPath(); ctx.arc(b.x, b.y, sr, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 1; ctx.strokeStyle = C.cyan; ctx.beginPath(); ctx.arc(b.x, b.y, sr * 0.82, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1;
    if (k < 0.08) { ctx.fillStyle = C.white; ctx.beginPath(); ctx.arc(b.x, b.y, b.r * 0.7, 0, Math.PI * 2); ctx.fill(); }
  }
}
function drawNukes() {
  for (const b of blasts) if (b.t >= 0) drawBlast(b);
  for (const n of nukes) {
    // lock-on brackets around the target
    const t = n.target;
    if (t && !t.dead && Math.floor(clock * 10) % 2) {
      const hw = t.w / 2 + 3, hh = t.h / 2 + 3, x0 = Math.round(t.x - hw), y0 = Math.round(t.y - hh), x1 = Math.round(t.x + hw), y1 = Math.round(t.y + hh);
      ctx.fillStyle = C.red;
      for (const [x, y, sx, sy] of [[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, 1, -1], [x1, y1, -1, -1]]) { ctx.fillRect(Math.min(x, x + sx * 3), y, 4, 1); ctx.fillRect(x, Math.min(y, y + sy * 3), 1, 4); }
    }
    // the missile: a body along its heading, a hot nose
    const a = Math.atan2(n.vy, n.vx);
    ctx.save(); ctx.translate(Math.round(n.x), Math.round(n.y)); ctx.rotate(a);
    ctx.fillStyle = C.white; ctx.fillRect(-4, -1.5, 7, 3);
    ctx.fillStyle = C.red; ctx.fillRect(3, -1, 2, 2);
    ctx.fillStyle = C.orange; ctx.fillRect(-5, -2.5, 2, 5);
    ctx.fillStyle = Math.floor(clock * 30) % 2 ? C.gold : C.white; ctx.fillRect(-7, -1, 2, 2);
    ctx.restore();
  }
}

function collect(p) {
  SFX.pick();
  switch (p.kind) {
    case 'P':
      if (player.power < MAX_POWER) { player.power++; run.bestPower = Math.max(run.bestPower, player.power); banner(WEAPON_NAMES[player.power], `POWER ${player.power}`, C.gold, 1.1); }
      else feat('MAXED', FEATS.maxedPickup, 0, p.x, p.y - 6);
      break;
    case 'R': player.rapid = 8; popup('RAPID FIRE', p.x, p.y - 6, C.lime); break;
    case 'S': player.shield = 1; popup('SHIELD', p.x, p.y - 6, C.cyan); break;
    case 'N': player.bombs = Math.min(3, player.bombs + 1); popup('+NUKE', p.x, p.y - 6, C.orange); break;
    case 'H': if (player.lives < 4) { player.lives++; popup('+LIFE', p.x, p.y - 6, C.pink); } else feat('MAXED', FEATS.maxedPickup, 0, p.x, p.y - 6); break;
  }
}

// ---------- update ----------
function fire() {
  const wp = WEAPONS[player.power];
  const rate = wp.rate * (player.rapid > 0 ? 1.6 : 1);
  player.fireCd = 1 / rate;
  const sp = 360, y = player.y - 5;
  for (const a of wp.angles) {
    const r = (a * Math.PI) / 180;
    if (wp.twin && a === 0) { for (const dx of [-3, 3]) bullets.push({ x: player.x + dx, y, vx: 0, vy: -sp, dmg: 1 }); }
    else bullets.push({ x: player.x, y, vx: Math.sin(r) * sp, vy: -Math.cos(r) * sp, dmg: 1 });
  }
  if (wp.laser) bullets.push({ x: player.x, y: y - 2, vx: 0, vy: -sp * 1.2, dmg: 2, pierce: true, hit: new Set(), laser: true });
  if (wp.wings) for (const dx of [-6, 6]) bullets.push({ x: player.x + dx, y: y + 4, vx: 0, vy: -sp, dmg: 1 });
  SFX.shot();
}

function aimAt(e, speed, off = 0) {
  const a = Math.atan2(player.y - e.y, player.x - e.x) + off;
  ebullets.push({ x: e.x, y: e.y + e.h / 2, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed });
}

function updateEnemy(e, dt) {
  e.t += dt; e.flash = Math.max(0, e.flash - dt);
  const s = e.speed;
  switch (e.type) {
    case 'drone':
      e.y += 20 * s * dt; e.x = e.anchorX + Math.sin((e.t + e.phase * 6) * 1.6) * 10;
      // a slow aimed shot every few seconds, from the first wave; it blinks white just before, so you can see it coming
      if (e.y > TOP + 16 && e.y < player.y - 50) {
        e.fireCd -= dt;
        e.warn = e.fireCd < 0.4;
        if (e.fireCd <= 0) { e.fireCd = Math.max(2.8, 4.6 - 0.12 * e.tier) + 1.5 * e.phase; e.warn = false; aimAt(e, 50 * s); }
      } else e.warn = false;
      break;
    case 'zigzag':
      e.y += 21 * s * dt; e.x += e.vx * dt;
      if (e.x < e.w / 2 + 2 || e.x > W - e.w / 2 - 2) { e.vx = -e.vx; e.x = Math.max(e.w / 2 + 2, Math.min(W - e.w / 2 - 2, e.x)); }
      break;
    case 'gunner':
      if (e.y < 60 + e.phase * 50) e.y += 28 * s * dt; else { e.y += 4 * s * dt; e.x = e.anchorX + Math.sin(e.t * 0.9) * 24; }
      e.fireCd -= dt;
      if (e.fireCd <= 0 && e.y > TOP + 10) { e.fireCd = Math.max(0.7, 2.1 - 0.1 * e.tier); aimAt(e, 72 * s); if (e.tier >= 6) aimAt(e, 72 * s, 0.22); }
      break;
    case 'splitter':
      e.y += 19 * s * dt; e.x = e.anchorX + Math.sin(e.t * 2.2) * 6;
      break;
    case 'mini':
      e.x += e.vx * dt; e.y += e.vy * s * dt; e.vx *= 1 - 0.9 * dt;
      break;
    case 'tank':
      e.y += 9 * s * dt;
      e.fireCd -= dt;
      if (e.fireCd <= 0) { e.fireCd = Math.max(1.0, 2.6 - 0.1 * e.tier); ebullets.push({ x: e.x, y: e.y + e.h / 2, vx: 0, vy: 80 * s }); }
      break;
    case 'diver':
      if (e.state === 0) { e.y += 34 * s * dt; if (e.y > 46 + e.phase * 30) { e.state = 1; e.t = 0; } }
      else if (e.state === 1) { if (e.t > 0.7) { e.state = 2; const dx = player.x - e.x, dy = player.y - e.y, d = Math.hypot(dx, dy) || 1; e.vx = (dx / d) * 150 * s; e.vy = (dy / d) * 150 * s; } }
      else { e.x += e.vx * dt; e.y += e.vy * dt; }
      break;
    case 'weaver':
      e.y += 13 * s * dt; e.x = e.anchorX + Math.sin(e.t * 1.3 + e.phase * 6) * 40;
      e.x = Math.max(e.w / 2, Math.min(W - e.w / 2, e.x));
      e.fireCd -= dt;
      if (e.fireCd <= 0 && e.y > TOP + 10) {
        e.fireCd = Math.max(0.9, 2.4 - 0.1 * e.tier);
        for (const a of [-0.35, 0, 0.35]) ebullets.push({ x: e.x, y: e.y + 4, vx: Math.sin(a) * 69 * s, vy: Math.cos(a) * 69 * s });
      }
      break;
    case 'blockmonster':
      // hovers and stays until it's taken out; aimed shots, every third volley a fan, a blink before each
      e.x += e.vx * dt;
      if (e.x < e.w / 2 + 4 || e.x > W - e.w / 2 - 4) { e.vx = -e.vx; e.x = Math.max(e.w / 2 + 4, Math.min(W - e.w / 2 - 4, e.x)); }
      e.y = TOP + 18 + Math.sin(e.t * 1.1) * 5;
      e.fireCd -= dt;
      e.warn = e.fireCd < 0.45;
      if (e.fireCd <= 0) {
        e.volley++; e.fireCd = 1.8; e.warn = false;
        if (e.volley % 3 === 0) for (const a of [-0.6, -0.3, 0, 0.3, 0.6]) ebullets.push({ x: e.x, y: e.y + 8, vx: Math.sin(a) * 52, vy: Math.cos(a) * 52 });
        else aimAt(e, 60);
      }
      break;
    case 'century':
      e.x += e.vx * dt;
      if (e.x < e.w / 2 + 2 || e.x > W - e.w / 2 - 2) { e.vx = -e.vx; e.x = Math.max(e.w / 2 + 2, Math.min(W - e.w / 2 - 2, e.x)); }
      e.y = TOP + 14 + Math.sin(e.t * 0.8) * 6;
      e.fireCd -= dt;
      if (e.fireCd <= 0) {
        e.fireCd = Math.max(0.6, 1.4 - 0.05 * e.tier);
        if (Math.floor(e.t) % 3 === 2) for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI + Math.PI * 0.05; ebullets.push({ x: e.x, y: e.y + 4, vx: Math.cos(a) * 62, vy: Math.sin(a) * 62 }); }
        else { aimAt(e, 86); }
      }
      e.life -= dt;
      if (e.life <= 0) { e.dead = true; e.escaped = true; popup('ESCAPED', e.x, e.y + 10, C.grey); }
      break;
  }
  if (e.y - e.h / 2 > BOTTOM || e.x < -20 || e.x > W + 20) {
    e.dead = true; e.escaped = true;
    if (e.y > BOTTOM - 4 && !isBoss(e)) { popup('BREACH!', Math.max(16, Math.min(W - 16, e.x)), BOTTOM - 12, C.red); hurt('breach'); }
  }
}

const overlap = (a, b, pad = 0) => Math.abs(a.x - b.x) < (a.w + b.w) / 2 - pad && Math.abs(a.y - b.y) < (a.h + b.h) / 2 - pad;

function update(dt) {
  clock += dt;
  for (const s of stars) { s.y += s.z * 14 * dt * (state === 'play' ? 1 + run.tier * 0.05 : 0.5); if (s.y > H) { s.y = 0; s.x = Math.random() * W; } }
  shake = Math.max(0, shake - dt * 20); flash = Math.max(0, flash - dt);
  for (const p of particles) { p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 1 - 2 * dt; p.vy *= 1 - 2 * dt; }
  particles = particles.filter((p) => p.t < p.life);
  for (const p of popups) { p.t += dt; p.y -= 14 * dt; }
  popups = popups.filter((p) => p.t < p.life);
  for (const b of beams) b.t -= dt;
  beams = beams.filter((b) => b.t > 0);
  if (banners.length) { banners[0].t += dt; if (banners[0].t > banners[0].life) banners.shift(); }
  for (const t of toasts) t.t += dt;
  toasts = toasts.filter((t) => t.t < t.life);
  if (state !== 'play' || paused) return;

  // ship: arrows, or ease toward the pointer; the lower part of the field only
  const sp = 120;
  if (pointer) {
    const dx = pointer.x - player.x, dy = pointer.y - player.y;
    player.x += Math.max(-sp * 1.8 * dt, Math.min(sp * 1.8 * dt, dx));
    player.y += Math.max(-sp * 1.8 * dt, Math.min(sp * 1.8 * dt, dy));
  } else {
    player.x += ((keys.right ? 1 : 0) - (keys.left ? 1 : 0)) * sp * dt;
    player.y += ((keys.down ? 1 : 0) - (keys.up ? 1 : 0)) * sp * dt;
  }
  player.x = Math.max(6, Math.min(W - 6, player.x));
  player.y = Math.max(H * 0.42, Math.min(BOTTOM - 6, player.y));
  player.invuln = Math.max(0, player.invuln - dt);
  player.rapid = Math.max(0, player.rapid - dt);
  player.fireCd -= dt;
  if (player.fireCd <= 0) fire();
  if (WEAPONS[player.power].homing) {
    player.missileCd -= dt;
    if (player.missileCd <= 0) { player.missileCd = 0.6; for (const d of [-1, 1]) bullets.push({ x: player.x + d * 5, y: player.y, vx: d * 60, vy: -80, dmg: 2, homing: true }); }
  }

  for (const b of bullets) {
    if (b.homing) {
      let best = null, bd = 1e9;
      for (const e of enemies) { if (e.dead) continue; const d = Math.hypot(e.x - b.x, e.y - b.y); if (d < bd) { bd = d; best = e; } }
      if (best) {
        const a = Math.atan2(best.y - b.y, best.x - b.x), v = 240;
        b.vx += (Math.cos(a) * v - b.vx) * Math.min(1, 6 * dt); b.vy += (Math.sin(a) * v - b.vy) * Math.min(1, 6 * dt);
      }
    }
    b.x += b.vx * dt; b.y += b.vy * dt;
  }
  bullets = bullets.filter((b) => b.y > TOP - 6 && b.y < H + 4 && b.x > -4 && b.x < W + 4 && !b.spent);

  for (const e of enemies) if (!e.dead) updateEnemy(e, dt);
  updateNukes(dt);

  // player bullets vs invaders
  for (const b of bullets) {
    if (b.spent) continue;
    for (const e of enemies) {
      if (e.dead || (b.hit && b.hit.has(e))) continue;
      if (Math.abs(b.x - e.x) < e.w / 2 + 1 && Math.abs(b.y - e.y) < e.h / 2 + 2) {
        damage(e, b.dmg);
        if (b.pierce) b.hit.add(e); else { b.spent = true; break; }
      }
    }
  }
  bullets = bullets.filter((b) => !b.spent);

  // invader fire and bodies vs the ship (a small hitbox: the cockpit)
  const core = { x: player.x, y: player.y, w: 5, h: 5 };
  for (const b of ebullets) {
    b.x += b.vx * dt; b.y += b.vy * dt;
    if (Math.abs(b.x - core.x) < 3.5 && Math.abs(b.y - core.y) < 3.5) { b.spent = true; hurt('shot'); }
  }
  ebullets = ebullets.filter((b) => !b.spent && b.y < H + 4 && b.y > -4 && b.x > -4 && b.x < W + 4);
  for (const e of enemies) if (!e.dead && overlap(e, core, 1)) { damage(e, isBoss(e) ? 2 : 99); hurt('ram'); }
  enemies = enemies.filter((e) => !e.dead);

  for (const p of pickups) {
    p.t += dt;
    const dx = player.x - p.x, dy = player.y - p.y, d = Math.hypot(dx, dy);
    if (d < 26) { p.x += (dx / (d || 1)) * 110 * dt; p.y += (dy / (d || 1)) * 110 * dt; } else p.y += 32 * dt;
    if (d < 7) { p.got = true; collect(p); }
  }
  pickups = pickups.filter((p) => !p.got && p.y < H + 6);
}

// ---------- draw ----------
function drawSprite(s, x, y, white) { ctx.drawImage(white ? s.flash : s.img, Math.round(x - s.w / 2), Math.round(y - s.h / 2)); }

function draw() {
  ctx.save();
  if (shake > 0) ctx.translate(Math.round((Math.random() - 0.5) * shake), Math.round((Math.random() - 0.5) * shake));
  ctx.fillStyle = C.bg; ctx.fillRect(-8, -8, W + 16, H + 16);
  for (const s of stars) { ctx.fillStyle = s.z === 1 ? C.star1 : s.z === 2 ? C.star2 : C.star3; ctx.fillRect(Math.round(s.x), Math.round(s.y), 1, s.z === 3 ? 2 : 1); }

  if (state !== 'title') {
    for (const b of beams) { ctx.fillStyle = `rgba(90,240,255,${b.t * 3})`; ctx.fillRect(Math.round(b.x) - 1, TOP, 2, Math.round(b.y - TOP) * (b.t / 0.12)); ctx.fillRect(Math.round(b.x) - 4, Math.round(b.y) - 1, 8, 2); }
    for (const p of pickups) {
      const pk = PICK[p.kind], blink = Math.floor(p.t * 6) % 2;
      ctx.fillStyle = C.ink; ctx.fillRect(Math.round(p.x) - 4, Math.round(p.y) - 4, 9, 9);
      ctx.fillStyle = blink ? C.white : pk.color; ctx.fillRect(Math.round(p.x) - 3, Math.round(p.y) - 3, 7, 7);
      drawText(pk.label, Math.round(p.x) - 1, Math.round(p.y) - 2, C.ink, 1, null);
    }
    for (const e of enemies) {
      const frames = SPR[e.type];
      const f = frames[Math.floor((clock + e.phase) * 3) % frames.length];
      if (e.type === 'diver' && e.state === 1 && Math.floor(e.t * 10) % 2) continue;
      drawSprite(f, e.x, e.y, e.flash > 0 || (e.warn && Math.floor(clock * 16) % 2 === 0));
      if (e.maxHp > 1 && e.hp < e.maxHp) {
        ctx.fillStyle = C.ink; ctx.fillRect(Math.round(e.x - e.w / 2), Math.round(e.y + e.h / 2 + 1), e.w, 1);
        ctx.fillStyle = C.lime; ctx.fillRect(Math.round(e.x - e.w / 2), Math.round(e.y + e.h / 2 + 1), Math.ceil((e.w * e.hp) / e.maxHp), 1);
      }
      // each invader carries the block that made it
      if (e.type !== 'mini') drawTextC(isBoss(e) ? `#${e.height}` : e.label, e.x, e.y - e.h / 2 - 7, e.height === run.lastHeight ? C.cyan : C.navy, 1, null);
    }
    for (const b of bullets) {
      ctx.fillStyle = b.laser ? C.pink : b.homing ? C.orange : C.white;
      if (b.laser) ctx.fillRect(Math.round(b.x) - 1, Math.round(b.y) - 5, 2, 8);
      else if (b.homing) ctx.fillRect(Math.round(b.x) - 1, Math.round(b.y) - 1, 2, 3);
      else ctx.fillRect(Math.round(b.x), Math.round(b.y) - 2, 1, 4);
    }
    for (const b of ebullets) {
      ctx.fillStyle = Math.floor(clock * 12) % 2 ? C.red : C.gold;
      ctx.fillRect(Math.round(b.x) - 1, Math.round(b.y) - 1, 3, 3);
    }
    if (state === 'play' && !(player.invuln > 0 && Math.floor(player.invuln * 12) % 2)) {
      drawSprite(SHIP[Math.floor(clock * 12) % 2], player.x, player.y);
      if (player.shield) { ctx.strokeStyle = Math.floor(clock * 6) % 2 ? C.cyan : C.white; ctx.strokeRect(Math.round(player.x) - 8.5, Math.round(player.y) - 7.5, 17, 15); }
    }
    for (const p of particles) { ctx.fillStyle = p.color; ctx.fillRect(Math.round(p.x), Math.round(p.y), 1, 1); }
    drawNukes();
    for (const p of popups) { if (p.t > p.life * 0.7 && Math.floor(p.t * 20) % 2) continue; drawTextC(p.text, Math.max(textWidth(p.text) / 2 + 1, Math.min(W - textWidth(p.text) / 2 - 1, p.x)), Math.round(p.y), p.color, p.k); }
  }
  ctx.restore();

  if (flash > 0) { ctx.globalAlpha = Math.min(0.55, flash * 2); ctx.fillStyle = flashColor; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }
  if (state !== 'title') drawHud();
  if (banners.length) {
    const b = banners[0], k = b.text.length > 11 ? 2 : 3;
    if (!(b.t > b.life - 0.3 && Math.floor(b.t * 20) % 2)) {
      drawTextC(b.text, W / 2, 92, b.color, k);
      if (b.sub) drawTextC(b.sub, W / 2, 92 + k * 5 + 6, C.white);
    }
  }
  toasts.forEach((t, i) => drawTextC(t.text, W / 2, H - 30 - i * 8, C.lime));
  if (paused) { ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(0, 0, W, H); drawTextC('PAUSED', W / 2, 110, C.gold, 3); drawTextC('PRESS P', W / 2, 132, C.white); }
}

function drawHud() {
  ctx.fillStyle = C.ink; ctx.fillRect(0, 0, W, TOP - 2); ctx.fillRect(0, BOTTOM, W, H - BOTTOM);
  ctx.fillStyle = C.navy; ctx.fillRect(0, TOP - 2, W, 1); ctx.fillRect(0, BOTTOM, W, 1);
  drawText(String(Math.floor(run.score)).padStart(7, '0'), 2, 2, C.white, 1, null);
  drawText('HI', 34, 2, C.grey, 1, null);
  drawText(String(Math.max(hiScore, Math.floor(run.score))).padStart(7, '0'), 43, 2, C.gold, 1, null);
  // block counter: flashes when a block lands
  const since = performance.now() - feed.lastAt;
  drawTextR(`#${feed.tip}`, W - 2, 2, since < 120 ? C.cyan : C.grey, 1, null);
  // multiplier with its four-block cooldown pips
  const mc = run.mult >= 16 ? C.pink : run.mult >= 8 ? C.orange : run.mult >= 4 ? C.cyan : C.white;
  drawText(`X${run.mult}`, 2, 8, mc, 1, null);
  // four pips: blocks left before it cools; the bar under them: charge toward the next step
  for (let i = 0; i < 4; i++) { ctx.fillStyle = i < 4 - run.blocksSinceKill ? mc : C.navy; ctx.fillRect(18 + i * 4, 8, 3, 3); }
  ctx.fillStyle = C.navy; ctx.fillRect(18, 12, 15, 1);
  ctx.fillStyle = C.gold; ctx.fillRect(18, 12, Math.round(15 * (run.mult >= MAX_MULT ? 1 : run.charge / need(run.mult))), 1);
  if (run.practice) drawText('PRACTICE', 38, 8, C.grey, 1, null);
  else drawText(`WAVE ${run.tier + 1}`, 38, 8, C.grey, 1, null);
  for (let i = 0; i < player.lives; i++) { ctx.fillStyle = C.pink; ctx.fillRect(W - 6 - i * 6, 9, 4, 3); ctx.fillRect(W - 5 - i * 6, 12, 2, 1); }
  // power, weapon, bombs
  for (let i = 0; i < MAX_POWER; i++) { ctx.fillStyle = i < player.power ? C.gold : C.navy; ctx.fillRect(2 + i * 4, BOTTOM + 3, 3, 4); }
  drawText(WEAPON_NAMES[player.power], 36, BOTTOM + 3, C.gold, 1, null);
  if (player.rapid > 0) drawText('RAPID', 76, BOTTOM + 3, C.lime, 1, null);
  for (let i = 0; i < player.bombs; i++) { ctx.fillStyle = C.orange; ctx.fillRect(W - 6 - i * 6, BOTTOM + 3, 4, 4); }
  drawTextR('NUKE', W - 22, BOTTOM + 3, player.bombs ? C.orange : C.navy, 1, null);
}

// ---------- game over and sealing ----------
function gameOver() {
  state = 'over';
  SFX.over();
  const blocks = run.lastHeight - run.startHeight;
  $('finalScore').textContent = fmt(run.score);
  $('finalStats').innerHTML = '';
  for (const [k, v] of [['Blocks survived', `${blocks} (${(blocks / 2).toFixed(1)}s)`], ['Invaders', run.kills], ['Best multiplier', `x${run.bestMult}`], ['Weapon', WEAPON_NAMES[run.bestPower]], ['Started at', `#${run.startHeight}`]]) {
    const a = document.createElement('span'); a.textContent = k; const b = document.createElement('b'); b.textContent = v;
    $('finalStats').append(a, b);
  }
  const canSeal = !run.practice && run.id && blocks > 0;
  $('scoreForm').hidden = !canSeal;
  $('sealMsg').className = 'msg';
  $('sealMsg').textContent = canSeal ? 'Seal your score on the chain. No sign-in.' : run.practice ? 'Practice run: not sealed on the chain.' : '';
  try { $('initials').value = localStorage.getItem('barrage.initials') || ''; } catch {}
  $('submitBtn').disabled = false;
  setTimeout(() => { $('over').hidden = false; if (canSeal) $('initials').focus(); }, 900);
}
$('againBtn').addEventListener('click', () => start());
$('scoreForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const initials = $('initials').value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3);
  if (!initials) { $('sealMsg').textContent = 'Type 1-3 letters first.'; return; }
  try { localStorage.setItem('barrage.initials', initials); } catch {}
  $('submitBtn').disabled = true;
  $('sealMsg').className = 'msg';
  $('sealMsg').textContent = 'Sending to the arcade...';
  const sent = performance.now();
  try {
    const r = await fetch('/api/score', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ runId: run.id, initials, score: Math.floor(run.score), endHeight: run.lastHeight, kills: run.kills, bestMultiplier: run.bestMult, powerLevel: run.bestPower }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'refused');
    $('sealMsg').textContent = 'Signed and broadcast. Waiting for a block...';
    const id = run.id;
    for (let i = 0; i < 200; i++) {
      await new Promise((res) => setTimeout(res, 150));
      const s = await (await fetch(`/api/score/${id}`)).json();
      if (s.status === 'sealed') {
        myRun = id; loadBoard();
        const secs = ((performance.now() - sent) / 1000).toFixed(2);
        $('sealMsg').className = 'msg ok';
        $('sealMsg').textContent = `SEALED IN BLOCK #${s.sealedHeight} in ${secs}s${s.rank ? ` - rank ${s.rank}` : ''}`;
        $('scoreForm').hidden = true;
        return;
      }
      if (s.status === 'failed') throw new Error(s.error);
    }
    throw new Error('no block took it in 30s');
  } catch (err) {
    $('sealMsg').textContent = `Not sealed: ${err.message}`;
    $('submitBtn').disabled = false;
  }
});

// ---------- loop ----------
let last = performance.now();
function frame(now) {
  const dt = Math.min(1 / 30, (now - last) / 1000);
  last = now;
  update(dt);
  draw();
  requestAnimationFrame(frame);
}
connectFeed();
loadBoard();
setInterval(loadBoard, 15000);
requestAnimationFrame(frame);
// for the dev console and tests
window.__barrage = { tick(dt) { update(dt); draw(); }, resume() { paused = false; }, get state() { return state; }, get run() { return run; }, get player() { return player; }, get enemies() { return enemies; }, steer(p) { pointer = p; }, start, bomb, get nukes() { return nukes; }, get blasts() { return blasts; }, feed, TIER_BLOCKS };
