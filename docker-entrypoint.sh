#!/bin/sh
# MCP-Config immer frisch schreiben (auth.json bleibt im Volume separat)
CONFIG="/home/node/.codex/config.toml"

# bestehende config ohne mcp_servers block behalten
if [ -f "$CONFIG" ]; then
  sed '/^\[mcp_servers/,$d' "$CONFIG" > "${CONFIG}.tmp"
  mv "${CONFIG}.tmp" "$CONFIG"
fi

cat >> "$CONFIG" << 'EOF'
[mcp_servers.otris-docs]
command = "node"
args = ["/app/src/mcp-stdio.js"]

[mcp_servers.otris-docs.env]
VAULTS_ROOT = "/app/vaults"
EOF

exec node src/server.js
