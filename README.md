# Block Barrage

An 8-bit fixed shooter on its own Canopy chain. The chain makes a block every 500ms, and **every block spawns one
invader**, labelled with its block height. Shoot them down before they reach the bottom. Waves get tougher every 12
seconds, power chips upgrade your ship, and the high-score board lives on the chain.

**Play it at https://blockbarrage.canopynetwork.org.**

There's no sign-in and no wallet. Open the page, click, play. When you seal a score, the arcade server signs a
`submit_score` transaction with its own key, and it lands in a block about a second later.

| Path | What it is |
|---|---|
| `public/` | The game: `index.html`, `style.css`, `game.js` (engine, sprites, sound) and `rules.js` (invaders, scoring, shared with the server) |
| `server/` | One Node process: the block feed (SSE), run tickets, score checks, and the relay that signs `submit_score` |
| `plugin/` | The Canopy plugin (TypeScript, from the core's template): `submit_score`, the board, read-only RPC |
| `chain/` | `setup.sh` (builds this project's own core), `localnet.sh` (the chain on this machine), `make-chain.py` (config and genesis) |
| `deploy/` | systemd units and a Caddy snippet |
| `test/`, `plugin/test/`, `scripts/e2e.js` | Rules and server checks, plugin unit tests, and an end-to-end run against a live localnet |

## Run it locally

Needs Node 22+ and Go (the build fetches Go 1.26.0 if needed). `setup.sh` clones the Canopy core into `chain/canopy`,
pins it to canopy#648 at `4313b031` (the fast-blocks PR, not merged upstream yet), applies two local patches and builds
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
genesis. `localnet.sh stop`, `status`, `logs [n]`, `speed [seconds]` and `reset` do what they say; everything the chain writes, the plugin
socket included, stays under `chain/data`.

**The first patch** (`chain/plugin-socket-dir.patch`). Upstream, the core hard-codes the plugin socket at
`/tmp/plugin/plugin.sock`, so two plugin chains on one machine collide. The patch reads the folder from
`CANOPY_PLUGIN_SOCKET_DIR` (default unchanged); the plugin and `pluginctl.sh` read the same variable. It touches no
consensus code.

**The second patch** (`chain/commit-race.patch`). A consensus message reads state without the controller lock, and a
commit can reset that state mid-read (`panic: pebble: closed`). At 500ms it is rare; at fast block times it crashes the
node within minutes. The patch takes the lock for that one read. It touches no consensus rules.

**Block time.** `init` paces blocks at 500ms (`roundRobinBlockIntervalMS`), which the game is tuned for.
`BLOCK_INTERVAL_MS=<ms> chain/localnet.sh init` picks another (on a fresh chain), and `localnet.sh speed` measures it.
With the plugin, the floor is about 40ms (real blocks every 41-50ms); below that, rounds time out and the chain slows
down.

If the chain can't be reached, the page falls back to local 500ms practice blocks and says so; practice runs aren't sealed.

| Env (server) | Default | |
|---|---|---|
| `CANOPY_RPC` | `http://127.0.0.1:31002` | Game chain RPC |
| `PLUGIN_RPC` | `http://127.0.0.1:31010` | The plugin's read-only RPC (the board) |
| `CHAIN_ID` / `NETWORK_ID` | `2` / `1` | Stamped into every transaction |
| `ARCADE_KEY_FILE` | `chain/.arcade-key.json` | Without it, the game runs but scores are off |
| `FEE` | `10000` | Per `submit_score`, in micro-units (the chain's send fee) |
| `PORT` / `HOST` | `8790` / `127.0.0.1` | Keep it on loopback behind a proxy |
| `TRUST_PROXY` | off | `1` when a proxy on this machine sets `X-Forwarded-For`; without it, all players share one rate limit |
| `MAX_PLAYERS` / `MAX_SEALS_PER_MINUTE` | `2000` / `120` | Open block feeds, and scores relayed per minute by everyone together |

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

- **Controls.** Move with the mouse, a finger (drag anywhere) or the arrows/WASD. Fire is automatic. Launch a nuke with Space
  or right-click (the NUKE button on phones). P pauses, M mutes.
- **Breaches.** An invader that reaches the bottom costs a life, as does a hit. A hit also drops one weapon level.
- **Waves.** The run opens with drones and zigzags, and the drones shoot: a slow aimed shot every few seconds, with a
  white blink just before it. Every 24 blocks (12 seconds) a new tier starts: gunners, then splitters, tanks, divers and
  weavers join. Invaders get 35% tougher and 8% faster per tier, and fire more often and faster; from wave 7 gunners fire in
  pairs. Divers wind up for less time before they dive.
- **The Blockmonster.** Every run opens with a boss already on screen, born from the block the run starts on and
  labelled with its height. It hovers at the top, fires aimed shots (it blinks just before) and every third volley a
  fan, and it stays until you take it out, while the blocks keep bringing invaders. Killing it pays 500 points plus a
  300 bonus and drops a weapon upgrade.
- **Nukes.** You start with one. A nuke is a heat-seeking missile: it locks onto the toughest invader on screen (a boss
  if there is one), chases it and detonates on contact, hitting everything within its blast for 14 damage and erasing
  enemy fire nearby. It is not a screen clear, so aim it with your position and timing.
- **Century boss.** On any block whose height ends in 00, a mothership arrives instead (not in a run's first 10
  seconds). It gets 15 more hit points per tier, fires faster and in wider fans, and escapes after 40 seconds.
- **Power chips** drop from about 1 invader in 6, chosen by the block hash (P from about 1 in 12):

| Chip | Effect |
|---|---|
| P | Weapon up: BLASTER, TWIN, TWIN+, SPREAD, WINGS, LASER, FAN, SWARM (homing missiles) |
| R | Rapid fire for 8 seconds |
| S | A shield that takes one hit |
| N | One more homing nuke (up to 3) |
| H | One more life (up to 4) |

### Multiplier

Kills score the invader's points × (1 + tier) × your multiplier. Feats charge the meter under the `xN` in the HUD; when
it fills, the multiplier steps up. Each step needs twice the current multiplier in charge, so x4 comes in about 10
seconds of sharp play, and x32 takes minutes of near-perfect play.

| Feat | When | Charge | Bonus |
|---|---|---|---|
| FINALITY | Kill an invader before the next block lands | 1 | 25 |
| DOUBLE / TRIPLE / MEGA KILL | 2, 3 or 5 kills within 150ms (spreads, lasers, nukes) | 1 / 2 / 3 | 50 / 100 / 200 |
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
deterministic, and bad scores are refused. It also starts the real server against a fake chain and attacks it: malformed
requests, path traversal, cross-site posts, forged addresses, feed flooding and leaked errors.

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

Only Caddy faces the internet. The game server, node and plugin RPC stay on loopback, and each service runs as its own
user in a systemd sandbox with no route off the machine. The units need systemd 247 or newer, Node 22 at `/opt/node`,
and Caddy.

**Do the firewall first.** The node's first boot uses default settings, and until `make-chain.py` runs those can listen
on every interface. Allow only SSH, 80 and 443:

```bash
sudo ufw default deny incoming && sudo ufw allow OpenSSH && sudo ufw allow 80,443/tcp && sudo ufw enable
```

Then, as root:

1. Create the users: `useradd -r -s /usr/sbin/nologin barrage-chain` and the same for `barrage-web`.
2. Put this repo at `/opt/barrage/app`, owned by root. Run `chain/setup.sh`, `npm ci --omit=dev` and
   `(cd plugin && npm ci && npm run build:all)` there (the core needs cgo, so build on the server).
3. Create the secrets, readable by root only:
   `install -d -m 700 /opt/barrage/secrets`, then
   `(umask 077; openssl rand -hex 32 > /opt/barrage/secrets/keystore-password)`, then
   `node server/keygen.js /opt/barrage/secrets/arcade-key.json`, which prints the arcade address.
4. Write `BARRAGE_ARCADE_AUTHORITY=<arcade address>` to `/opt/barrage/barrage.env`.
5. `install -d -o barrage-chain -g barrage-chain -m 700 /opt/barrage/data /opt/barrage/data/game /opt/barrage/data/game/plugin`,
   then first-boot the node as `barrage-chain` from `app/chain/canopy`, and stop it once `config.json`, `keystore.json`
   and `genesis.json` exist (`runuser` is in `/usr/sbin`):
   `runuser -u barrage-chain -- env CANOPY_DATA_DIR=/opt/barrage/data/game /opt/barrage/app/chain/bin/canopy --data-dir /opt/barrage/data/game --password "$(cat /opt/barrage/secrets/keystore-password)" --nickname barrage start`
6. Run `chain/make-chain.py /opt/barrage/data/game <arcade address>` and delete `data/game/canopy` so the edited genesis
   applies. Make sure the files are still owned by `barrage-chain`.
7. Install both units and the Caddy snippet (with your domain), then start `barrage-game` and `barrage-web`.
8. Check from another machine that only 22, 80 and 443 answer: `nmap -p- <host>`.

The chain grows by about 240 MB a day at 500ms, so watch the disk. Top up the arcade key if `/barrage/arcade` runs low:
it starts with enough for 100 million scores.

### The live server

https://blockbarrage.canopynetwork.org runs this setup on one Ubuntu 26.04 server (`ssh root@2.29.137.199`, 2 cores,
3.7 GB), deployed on 2026-11-19. Caddy there also serves abbey.skylabs.ventures; the Barrage block is at the end of
`/etc/caddy/Caddyfile`, and the `Caddyfile.bak-*` files next to it are the versions before each change. The block feed
must not be compressed (`encode` skips `/api/blocks`): compressed, it reaches browsers in bursts and the game falls back
to practice blocks.

Ship a change (from a clean checkout of what is on GitHub):

```bash
git archive HEAD | ssh root@2.29.137.199 'tar -x -C /opt/barrage/app && chown -R root:root /opt/barrage/app'
```

```bash
ssh root@2.29.137.199 'cd /opt/barrage/app && export PATH=/opt/node/bin:/usr/bin:/bin && npm ci --omit=dev && (cd plugin && npm ci && npm run build:all && npm prune --omit=dev) && systemctl restart barrage-web'
```

A rules or plugin change also needs `systemctl restart barrage-game`, and one that changes the score ceiling needs a
fresh chain. To start the chain over (this empties the board):

```bash
ssh root@2.29.137.199 'systemctl stop barrage-web barrage-game && rm -rf /opt/barrage/data/game/canopy /opt/barrage/data/game/logs && systemctl start barrage-game && sleep 5 && systemctl start barrage-web'
```

Look at it:

```bash
ssh root@2.29.137.199 'systemctl status barrage-game barrage-web --no-pager | grep -E "●|Active"; du -sh /opt/barrage/data/game'
```

## Security

What the server does against abuse:

| Attack | Defence |
|---|---|
| Malformed or oversized requests | Refused without touching game state; bodies capped at 16 KB, headers at 8 KB; slow requests time out |
| Reading files off the server | Only the page's own files can be served, from a fixed list |
| Flooding | Per-address limits on every route (IPv6 by /64), caps on open block feeds and players, slow readers dropped, all tables bounded |
| Spamming the chain | Scores are limited per address and to 120 a minute overall, and each run seals once |
| Forged client addresses | `X-Forwarded-For` counts only from a local proxy, and only the entry that proxy wrote |
| Other sites acting for a player, clickjacking, script injection | Cross-site POSTs refused, no CORS, framing denied, a strict Content-Security-Policy with no inline code |
| Learning about the internals | Chain errors are logged, never sent to players |
| A compromised web process | No internet access, no access to chain data or the validator's password, and the score key is its only secret |

Report a vulnerability through a private GitHub security advisory on this repo.

## Limits

- **No accounts means no proof of play. The leaderboard can be cheated.** The game runs in the browser, so the server
  can't see what really happened. It rejects scores the run's blocks make impossible, runs played faster than the chain
  (under 0.35s per block), run tickets over 2 hours old, reused run ids, and too many requests per address, and the
  plugin repeats the checks it can. A script can still start a run, wait, and claim a high score under the ceiling.
- **Flood protection stops at this server.** A large distributed attack needs a CDN or your host's protection in front.
- **The arcade key is the one trust point.** Anyone holding it can write scores. It never leaves the server, and the
  plugin accepts scores from no other key.
- **Plugin state is consensus state.** Changing `maxScore` or the board rules changes how `submit_score` executes. Do
  it on a fresh chain or behind an activation height.
- **Fast blocks are unreleased core code** (canopy#648, pinned at `4313b031`). Production would mean running that fork.

## License

MIT: see [LICENSE](LICENSE). `plugin/` is built from the Canopy plugin template and `chain/*.patch` modify the Canopy
core, both MIT-licensed by Canopy Network; their notice is in [plugin/LICENSE.canopy](plugin/LICENSE.canopy).
