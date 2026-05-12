FROM node:20-slim AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY tsconfig.json tsconfig.build.json ./
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

# Python tools (for MCP helpers and the optional Aider provider)
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pip && \
    pip3 install --break-system-packages mcp-atlassian aider-chat && \
    rm -rf /var/lib/apt/lists/*

# Writable runtime directories. docker-compose runs this image as uid/gid 1000
# with a read-only root filesystem, so persistent state must live under /app/data
# and temporary CLI/cache files under /tmp.
RUN mkdir -p /app/data && chown -R 1000:1000 /app/data

ENV NODE_ENV=production
ENV STATE_FILE=/app/data/state.json
ENV HOME=/tmp
ENV XDG_CACHE_HOME=/tmp/.cache
ENV AIDER_PATH=aider
CMD ["node", "dist/index.js"]
