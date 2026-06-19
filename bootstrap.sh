#!/usr/bin/env bash
set -euo pipefail

NODE_BIN="${TUTTI_APP_NODE:-node}"
PACKAGE_DIR="${TUTTI_APP_PACKAGE_DIR:-$(cd "$(dirname "$0")" && pwd)}"

exec "$NODE_BIN" "$PACKAGE_DIR/server/server.js"
