#!/usr/bin/env python3
"""
Turn a first-boot data dir into Block Barrage's chain: one chain (id 2) that is its own root, 500ms round-robin blocks
(canopy-network/canopy#648), the barrage plugin, one validator, and the arcade key funded for score fees.
The core treats a chain as its own root when its config chainId equals the genesis rootChainID.

Ports: RPC 31002, admin 31003, P2P 9012 (loopback only). Usage: make-chain.py <data dir> <arcade address> [block interval ms] [lead time ms]
"""

import json
import os
import re
import sys

data, arcade = sys.argv[1], sys.argv[2].lower()
assert re.fullmatch(r"[0-9a-f]{40}", arcade), "arcade address must be 40 hex chars"
CHAIN_ID, PORT, P2P = 2, "310", 9012
# The core's fast mode stamps each block one interval after the last and holds the commit until then
# (roundRobinBlockIntervalMS; 0 means the 500ms default). The game is tuned for 500ms. The same interval is each round's
# deadline, so below what a round really takes (~35-40ms with the plugin on one validator) rounds time out, back off
# and the chain gets slower, not faster. Measured with `localnet.sh speed` on the dev Mac: 30ms -> 61ms/block,
# 35ms -> 47ms, 38ms -> 43ms, 40ms -> 41-50ms (~22 blocks/s, the fastest), 50ms -> 53ms. The lead time is the slack a
# proposal gets before its timestamp.
INTERVAL_MS = int(sys.argv[3]) if len(sys.argv) > 3 else 500
LEAD_MS = int(sys.argv[4]) if len(sys.argv) > 4 else 175

c = json.load(open(os.path.join(data, "config.json")))
c.update({
    "chainId": CHAIN_ID,
    "rootChain": [{"chainId": CHAIN_ID, "url": f"http://127.0.0.1:{PORT}02"}],
    "plugin": "barrage",
    "autoUpdate": False,
    "pluginAutoUpdate": {**c.get("pluginAutoUpdate", {}), "enabled": False},
    "dataDirPath": data,
    "backupDirectory": data + "/backup",
    "listenAddress": f"127.0.0.1:{P2P}",
    "dialPeers": [],
    "metricsEnabled": False,
    "prometheusAddress": f"127.0.0.1:{P2P + 89}",
    "walletPort": f"{PORT}00", "explorerPort": f"{PORT}01", "rpcPort": f"{PORT}02", "adminPort": f"{PORT}03",
    "rpcURL": f"http://127.0.0.1:{PORT}02", "adminRPCUrl": f"http://127.0.0.1:{PORT}03",
    "profilingPort": f"{P2P - 2940}",
    "headless": True,
    # fast mode (canopy#648): stake-weighted round-robin proposers, paced at INTERVAL_MS
    "proposerMode": "stakeWeightedRoundRobin", "roundRobinBlockIntervalMS": INTERVAL_MS,
    "blockConsensusLeadTimeMS": LEAD_MS, "maximumFutureBlockTimeMS": 1000, "runVDF": False,
    "newHeightTimeoutMS": 500, "electionTimeoutMS": 100, "electionVoteTimeoutMS": 500, "proposeTimeoutMS": 500,
    "proposeVoteTimeoutMS": 500, "precommitTimeoutMS": 500, "precommitVoteTimeoutMS": 500, "commitTimeoutMS": 500,
    "roundInterruptTimeoutMS": 250,
})

# the core binds its RPC, admin and profiling ports to this host: they must never face the network
assert c["listenAddress"].startswith("127.0.0.1:") and c["headless"], "the node must stay on loopback and headless"

g = json.load(open(os.path.join(data, "genesis.json")))
assert len(g["validators"]) == 1, "expected one genesis validator"
g["params"]["consensus"]["rootChainID"] = CHAIN_ID
g["validators"][0]["committees"] = [CHAIN_ID]
validator = g["validators"][0]["address"]
g["accounts"] = [
    {"address": validator, "amount": 1_000_000},
    # score fees: 10,000 micro-units each, so this pays for 100 million scores
    {"address": arcade, "amount": 1_000_000_000_000},
]

for name, obj in (("config.json", c), ("genesis.json", g)):
    with open(os.path.join(data, name), "w") as f:
        json.dump(obj, f, indent=2)
print(f"chain {CHAIN_ID} (its own root): validator {validator}, arcade {arcade} funded, interval {INTERVAL_MS}ms, lead {LEAD_MS}ms")
