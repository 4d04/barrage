#!/bin/bash
# setup.sh - fetch and build this project's own Canopy core, pinned to one commit, with two local patches.
# canopy-network/canopy#648 ("fast deterministic BFT mode") at 4313b031; not merged upstream yet.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CANOPY_COMMIT="${CANOPY_COMMIT:-4313b031}"
SRC="$HERE/canopy"

if [ ! -d "$SRC/.git" ]; then
    git clone https://github.com/canopy-network/canopy.git "$SRC"
fi
if ! git -C "$SRC" cat-file -e "$CANOPY_COMMIT^{commit}" 2>/dev/null; then
    git -C "$SRC" fetch --quiet origin pull/648/head development main
fi
git -C "$SRC" checkout --quiet -- controller/controller.go bft/msg.go 2>/dev/null || true
git -C "$SRC" checkout --quiet --detach "$CANOPY_COMMIT"
# local patch: the plugin socket folder comes from CANOPY_PLUGIN_SOCKET_DIR (default /tmp/plugin), so this chain's
# plugin socket can't collide with another plugin chain on the same host
git -C "$SRC" apply "$HERE/plugin-socket-dir.patch"
# local patch: a consensus read that races block commits and panics the node within minutes at ~36ms blocks
git -C "$SRC" apply "$HERE/commit-race.patch"

# the embedded wallet and explorer UIs aren't needed headless: placeholder pages let the core build
for d in cmd/rpc/web/explorer/dist cmd/rpc/web/wallet/out; do
    mkdir -p "$SRC/$d"
    [ -f "$SRC/$d/index.html" ] || echo placeholder > "$SRC/$d/index.html"
done
# the core runs plugin/<name>/pluginctl.sh relative to its checkout
ln -sfn ../../../plugin "$SRC/plugin/barrage"

mkdir -p "$HERE/bin"
# Go 1.26.0: newer toolchains break a dependency (cockroachdb/swiss); go downloads this one if it is missing
(cd "$SRC" && GOTOOLCHAIN=go1.26.0 go build -o ../bin/canopy ./cmd/main/)
echo "built $HERE/bin/canopy at canopy@$CANOPY_COMMIT (+ plugin-socket-dir.patch, commit-race.patch)"
