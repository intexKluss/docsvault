#!/bin/sh
# MCP-Config immer frisch schreiben (auth.json bleibt im Volume separat)
CONFIG="/home/node/.codex/config.toml"

# nur den docsvault-block (inkl. .env) entfernen, der rest der config bleibt.
# wir loeschen ab einer [mcp_servers.docsvault...]-section bis zur naechsten
# section ([..]) oder EOF, damit unbeteiligte trailing-config ueberlebt
if [ -f "$CONFIG" ]; then
  awk '
    /^\[mcp_servers\.docsvault(\.|\])/ { skip=1; next }
    /^\[/ { skip=0 }
    !skip { print }
  ' "$CONFIG" > "${CONFIG}.tmp"
  mv "${CONFIG}.tmp" "$CONFIG"
fi

cat >> "$CONFIG" << 'EOF'
[mcp_servers.docsvault]
command = "node"
args = ["/app/src/mcp-stdio.js"]

[mcp_servers.docsvault.env]
VAULTS_ROOT = "/app/vaults"
EOF

exec node src/server.js
