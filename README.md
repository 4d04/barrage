# Block Barrage

An 8-bit fixed shooter on its own Canopy chain. The chain makes a block every 500ms, and **every block spawns one
invader**, labelled with its block height. Shoot them down before they reach the bottom. Waves get tougher every 15
seconds, power chips upgrade your ship, and the high-score board lives on the chain.

There's no sign-in and no wallet. Open the page, click, play. When you seal a score, the arcade server signs a
`submit_score` transaction with its own key, and it lands in a block about a second later.

| Path | What it is |
|---|---|
| `public/` | The game: `index.html`, `game.js` (engine, sprites, sound) and `rules.js` (invaders, scoring, shared with the server) |
| `server/` | One Node process: the block feed (SSE), run tickets, score checks, and the relay that signs `submit_score` |
| `plugin/` | The Canopy plugin (TypeScript, from the core's template): `submit_score`, the board, read-only RPC |
| `chain/` | `setup.sh` (builds this project's own core), `localnet.sh` (the chain on this machine), `make-chain.py` (config and genesis) |
| `deploy/` | systemd units and a Caddy snippet |
| `test/`, `plugin/test/`, `scripts/e2e.js` | Rules and server checks, plugin unit tests, and an end-to-end run against a live localnet |

## Run it locally

Needs Node 22+ and Go (the build fetches Go 1.26.0 if needed). `setup.sh` clones the Canopy core into `chain/canopy`,
pins it to canopy#648 at `4313b031` (the fast-blocks PR, not merged upstream yet), applies one local patch and builds
`chain/bin/canopy`. Nothing here depends on another project.

```bash
chain/setup.sh
```

```bash
npm install && (cd plugin && npm ci && npm run build:all)
```

```bash
chain/localnet.sh init
```

```bash
chain/localnet.sh start
```

```bash
npm start
```

Then open http://127.0.0.1:8790. `init` makes the arcade key (`chain/.arcade-key.json`, git-ignored) and funds it in
genesis. `localnet.sh stop`, `status`, `logs [n]` and `reset` do what they say; everything the chain writes, the plugin
socket included, stays under `chain/data`.

**The core patch** (`chain/plugin-socket-dir.patch`). Upstream, the core hard-codes the plugin socket at
`/tmp/plugin/plugin.sock`, so two plugin chains on one machine collide. The patch reads the folder from
`CANOPY_PLUGIN_SOCKET_DIR` (default unchanged); the plugin and `pluginctl.sh` read the same variable. It touches no
consensus code.

If the chain can't be reached, the page falls back to local 500ms practice blocks and says so; practice runs aren't sealed.

| Env (server) | Default | |
|---|---|---|
| `CANOPY_RPC` | `http://127.0.0.1:31002` | Game chain RPC |
| `PLUGIN_RPC` | `http://127.0.0.1:31010` | The plugin's read-only RPC (the board) |
| `CHAIN_ID` / `NETWORK_ID` | `2` / `1` | Stamped into every transaction |
| `ARCADE_KEY_FILE` | `chain/.arcade-key.json` | Without it, the game runs but scores are off |
| `FEE` | `10000` | Per `submit_score`, in micro-units (the chain's send fee) |
| `PORT` / `HOST` / `TRUST_PROXY` | `8790` / `127.0.0.1` / off | |

## The chain

One Canopy chain, id 2, that is **its own root**: the core treats a chain as its own root when its `chainId` equals the
genesis `rootChainID`. There's no root chain to run, no committee staking on another chain and no peers: one validator,
500ms round-robin blocks (canopy#648's fast mode), the `barrage` plugin.

| | Port |
|---|---|
| RPC / admin | 31002 / 31003 (loopback) |
| P2P | 9012 (loopback) |
| Plugin RPC | 31010 (loopback) |

**What's on chain.** The plugin registers one message, `submit_score`, which only the arcade key can sign (set with
`BARRAGE_ARCADE_AUTHORITY`; unset means every score is refused). Its checks:
- initials are 1-3 of A-Z and 0-9;
- the run ended at or before the block that records it;
- each run id is recorded once;
- the score is under the run's ceiling (`maxScore`, mirrored in `public/rules.js` and `plugin/src/arcade/rules.ts`; a test keeps them equal);
- kills, best multiplier and power level are within range.

It keeps the top 100 (score, then whoever got there first), every run's record, and totals.

| Plugin RPC | Returns |
|---|---|
| `GET /barrage/board?limit=10` | The top of the board |
| `GET /barrage/run?id=<hex>` | One run's record and the rank it got |
| `GET /barrage/stats` | Runs, kills, best score, blocks played |
| `GET /barrage/arcade` | The arcade address and its balance |

Every route takes `?height=` for a snapshot.

**Where the invaders come from.** Each block's hash picks the invader's type, entry point and drop, so everyone playing
sees the same invader for the same block. The tier comes from how many blocks the run has lasted. The server polls the
node once per 100ms and pushes each block (height, hash, time) to every player over one SSE stream.

## How it plays

- **Controls.** Move with the mouse, a finger (drag anywhere) or the arrows/WASD. Fire is automatic. Bomb with Space or
  right-click (the BOMB button on phones). P pauses, M mutes.
- **Breaches.** An invader that reaches the bottom costs a life, as does a hit. A hit also drops one weapon level.
- **Waves.** Every 30 blocks (15 seconds) a new tier starts: zigzags, then gunners, splitters, tanks, divers and weavers
  join. Invaders get 25% tougher and 6% faster per tier, and fire more often.
- **Century boss.** On any block whose height ends in 00, a mothership arrives instead (not in a run's first 10
  seconds). It escapes after 20 seconds.
- **Power chips** drop from invaders, chosen by the block hash:

| Chip | Effect |
|---|---|
| P | Weapon up: BLASTER, TWIN, TWIN+, SPREAD, WINGS, LASER, FAN, SWARM (homing missiles) |
| R | Rapid fire for 8 seconds |
| S | A shield that takes one hit |
| B | One more bomb (up to 3) |
| H | One more life (up to 5) |

### Multiplier

Kills score the invader's points × (1 + tier) × your multiplier. Feats charge the meter under the `xN` in the HUD; when
it fills, the multiplier steps up. Each step needs twice the current multiplier in charge, so x4 comes in about 10
seconds of sharp play, and x32 takes minutes of near-perfect play.

| Feat | When | Charge | Bonus |
|---|---|---|---|
| FINALITY | Kill an invader before the next block lands | 1 | 25 |
| DOUBLE / TRIPLE / MEGA KILL | 2, 3 or 5 kills within 150ms (spreads, lasers, bombs) | 1 / 2 / 3 | 50 / 100 / 200 |
| COMBO | Every 8 kills without the multiplier cooling | 2 | 100 |
| UNBROKEN CHAIN | Every 40 blocks without getting hit | 4 | 200 |
| CENTURY DOWN | Destroy the century boss | 8 | 500 |

Bonuses are multiplied too. The multiplier cools on the chain's clock: **four blocks without a kill halves it** (the four
pips next to it count down). A hit resets it to x1. Crossing x4, x8, x16 and x32 flashes NICE!, ON FIRE!, 500MS
MADNESS! and MAX FINALITY!

## Tests

```bash
cd barrage && npm test
```

The rules and server checks: plugin and game agree on the ceiling, the ceiling covers a perfect block, spawns are
deterministic, and bad scores are refused.

```bash
cd barrage/plugin && npm test
```

The real CheckTx and DeliverTx over in-memory state: authority, every shape check, future heights, replays, fees, board
order and cap, byte-identical replay on two instances, and fail-closed without an authority.

```bash
cd barrage && node scripts/e2e.js
```

Needs the localnet and server running. It starts a run, waits real blocks, checks that an impossible score is refused,
seals a score and times it, checks that a replay is refused, and reads the board back from the chain.

## Deploy

The files in `deploy/` assume `/opt/barrage` with:
- `app/`, this directory, with `chain/setup.sh` run on the server (the core needs cgo, so build it there);
- `bin/canopy`, a copy of `app/chain/bin/canopy`, and `canopy/`, the core checkout (`app/chain/canopy`);
- `data/game`;
- `.password`, `arcade-key.json` and `barrage.env` (`BARRAGE_ARCADE_AUTHORITY=<arcade address>`).

Set it up like this:
1. Make the key on the server with `node server/keygen.js /opt/barrage/arcade-key.json`.
2. First-boot `data/game`.
3. Run `chain/make-chain.py /opt/barrage/data/game <arcade address>`.
4. Delete `data/game/canopy` so the edited genesis applies.
5. Start `barrage-game` and `barrage-web`, and add the Caddy snippet.

Nothing here has been deployed.

## Limits

- **No accounts means no proof of play.** The server rejects scores the run's blocks make impossible, runs played
  faster than the chain (under 0.35s per block), reused run ids, and too many requests per IP. The plugin repeats the
  checks that can run on chain. A determined cheater can still submit a plausible fake score.
- **The arcade key is the one trust point.** Anyone holding it can write scores. It never leaves the server, and the
  plugin accepts scores from no other key.
- **Plugin state is consensus state.** Changing `maxScore` or the board rules changes how `submit_score` executes. Do
  it on a fresh chain or behind an activation height.
- **Fast blocks are unreleased core code** (canopy#648, pinned at `4313b031`). Production would mean running that fork.
