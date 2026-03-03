FROM node:20-slim AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ─── Runtime ──────────────────────────────────────────────────
FROM node:20-slim
WORKDIR /app

# Docker CLI (for spawning executor containers)
RUN apt-get update && apt-get install -y --no-install-recommends docker.io git && \
    rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

COPY --from=builder /app/dist ./dist

# Python tools (for mcp-atlassian and mcp-bitbucket)
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pip && \
    pip3 install --break-system-packages uvx mcp-atlassian mcp-bitbucket && \
    rm -rf /var/lib/apt/lists/*

# Data directory for state
RUN mkdir -p /app/data

ENV NODE_ENV=production
CMD ["node", "dist/index.js"]
