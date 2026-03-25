#!/bin/sh
# MCP-Config in codex config.toml sicherstellen (stdio, kein HTTP overhead)
CONFIG="/home/node/.codex/config.toml"
if ! grep -q "mcp_servers" "$CONFIG" 2>/dev/null; then
  cat >> "$CONFIG" << 'EOF'

[mcp_servers.otris-docs]
command = "node"
args = ["/app/src/mcp-stdio.js"]

[mcp_servers.otris-docs.env]
VAULT_PATH = "/app/vault"
EOF
fi

exec node src/server.js
