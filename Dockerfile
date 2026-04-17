FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev --legacy-peer-deps

# codex CLI aus node_modules global verlinken
RUN ln -s /app/node_modules/.bin/codex /usr/local/bin/codex

# codex config dir fuer auth volume
RUN mkdir -p /home/node/.codex && chown node:node /home/node/.codex

COPY src/ ./src/
COPY public/ ./public/
COPY docker-entrypoint.sh ./
RUN sed -i 's/\r$//' docker-entrypoint.sh && chmod +x docker-entrypoint.sh
RUN mkdir -p /app/vaults && chown node:node /app/vaults
VOLUME ["/app/vaults"]

# reports.json als leere JSONL-Datei anlegen — wird beim Betrieb gefuellt
RUN touch /app/reports.json && chown node:node /app/reports.json

USER node

EXPOSE 3000

ENV NODE_ENV=production
ENV VAULTS_ROOT=/app/vaults
ENV BRIDGE=codex

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/api/health').then(r=>{if(!r.ok)throw 1}).catch(()=>process.exit(1))"

CMD ["./docker-entrypoint.sh"]
