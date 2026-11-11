#!/usr/bin/env python3
"""
Turn a first-boot data dir into Block Barrage's chain: one chain (id 2) that is its own root, 500ms round-robin blocks
(canopy-network/canopy#648), the barrage plugin, one validator, and the arcade key funded for score fees.
The core treats a chain as its own root when its config chainId equals the genesis rootChainID.

Ports: RPC 31002, admin 31003, P2P 9012 (loopback only). Usage: make-chain.py <data dir> <arcade address>
"""

import json
import os
import re
import sys

data, arcade = sys.argv[1], sys.argv[2].lower()
assert re.fullmatch(r"[0-9a-f]{40}", arcade), "arcade address must be 40 hex chars"
CHAIN_ID, PORT, P2P = 2, "310", 9012

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
    # fast mode (canopy#648): stake-weighted round-robin proposers, 500ms pacing
    "proposerMode": "stakeWeightedRoundRobin", "roundRobinBlockIntervalMS": 500,
    "blockConsensusLeadTimeMS": 175, "maximumFutureBlockTimeMS": 1000, "runVDF": False,
    "newHeightTimeoutMS": 500, "electionTimeoutMS": 100, "electionVoteTimeoutMS": 500, "proposeTimeoutMS": 500,
    "proposeVoteTimeoutMS": 500, "precommitTimeoutMS": 500, "precommitVoteTimeoutMS": 500, "commitTimeoutMS": 500,
    "roundInterruptTimeoutMS": 250,
})

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
print(f"chain {CHAIN_ID} (its own root): validator {validator}, arcade {arcade} funded")
