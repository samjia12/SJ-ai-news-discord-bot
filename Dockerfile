FROM node:22-bookworm-slim
WORKDIR /app

ENV NODE_ENV=production

# better-sqlite3 needs build tooling in many environments.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

# Install deps (use lockfile when present)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy source
COPY src ./src

EXPOSE 3000

# Simple healthcheck (optional; Docker Compose can use it)
HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/index.mjs"]
