FROM node:20-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY src/ ./src/
COPY public/ ./public/
COPY vault/ ./vault/

USER node

EXPOSE 3000

ENV NODE_ENV=production
ENV VAULT_PATH=/app/vault
ENV BRIDGE=codex

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/api/health').then(r=>{if(!r.ok)throw 1}).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
