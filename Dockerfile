FROM node:20-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY src/ ./src/
COPY public/ ./public/
COPY vault/ ./vault/
COPY .mcp.json ./

EXPOSE 3000

ENV NODE_ENV=production
ENV VAULT_PATH=/app/vault
ENV BRIDGE=codex

CMD ["node", "src/server.js"]
