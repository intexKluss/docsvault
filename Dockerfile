FROM node:20-slim

WORKDIR /app

# Copy otris-docs-mcp for file dependency resolution
COPY otris-docs-mcp /otris-docs-mcp

# Copy web app package files and install
COPY otris-docs-web/package*.json ./
RUN npm ci --omit=dev

# Copy application source
COPY otris-docs-web/src/ ./src/
COPY otris-docs-web/public/ ./public/
COPY otris-docs-web/vault/ ./vault/

EXPOSE 3000

ENV NODE_ENV=production
ENV VAULT_PATH=/app/vault

CMD ["node", "src/server.js"]
