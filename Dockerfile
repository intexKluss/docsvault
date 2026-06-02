FROM node:20-slim

# ripgrep (rg) fuer schnelle Volltextsuche; ohne faellt der Server auf eine
# langsamere Node-Implementierung zurueck (siehe README -> Volltextsuche)
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates ripgrep && rm -rf /var/lib/apt/lists/*

# tini als init fuer korrektes zombie-reaping (node als PID 1 raeumt
# verwaiste codex-grandchildren nicht ab)
RUN apt-get update && apt-get install -y --no-install-recommends tini && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev --legacy-peer-deps

# codex CLI global verfuegbar machen. KEIN symlink: der npm-shim sucht
# seinen launcher relativ zu $0 (ohne readlink), ueber den symlink also unter
# /usr/local/@openai/... -> MODULE_NOT_FOUND. wrapper ruft den launcher direkt
RUN printf '#!/bin/sh\nexec node /app/node_modules/@openai/codex/bin/codex.js "$@"\n' > /usr/local/bin/codex && chmod +x /usr/local/bin/codex

# codex config dir fuer auth volume
RUN mkdir -p /home/node/.codex && chown node:node /home/node/.codex

COPY src/ ./src/
COPY public/ ./public/
COPY docker-entrypoint.sh ./
RUN sed -i 's/\r$//' docker-entrypoint.sh && chmod +x docker-entrypoint.sh
RUN mkdir -p /app/vaults && chown node:node /app/vaults

# reports.json als leere JSONL-Datei anlegen, wird beim Betrieb gefuellt
RUN touch /app/reports.json && chown node:node /app/reports.json

USER node

EXPOSE 3000

ENV NODE_ENV=production
ENV VAULTS_ROOT=/app/vaults
ENV BRIDGE=codex

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/api/health').then(r=>{if(!r.ok)throw 1}).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["./docker-entrypoint.sh"]
