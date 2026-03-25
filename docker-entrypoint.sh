#!/bin/sh
# MCP-Config in codex config.toml sicherstellen
CONFIG="/home/node/.codex/config.toml"
if ! grep -q "mcp_servers" "$CONFIG" 2>/dev/null; then
  echo '' >> "$CONFIG"
  echo '[mcp_servers.otris-docs]' >> "$CONFIG"
  echo 'url = "http://localhost:3000/mcp"' >> "$CONFIG"
fi

exec node src/server.js
