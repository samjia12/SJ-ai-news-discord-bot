FROM node:22-bookworm-slim
WORKDIR /app

ENV NODE_ENV=production

# Install deps
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# Copy source
COPY src ./src

EXPOSE 3000
CMD ["node", "src/index.mjs"]
