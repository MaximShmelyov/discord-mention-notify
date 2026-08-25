# ── Build stage ──
FROM node:24-slim AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci --no-audit --no-fund

COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build

# ── Production stage ──
FROM node:24-slim

WORKDIR /app
ENV NODE_ENV=production
ENV DATA_DIR=/app/data

COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund \
  && npm cache clean --force

COPY --from=build /app/dist/ ./dist/

RUN mkdir -p /app/data \
  && echo '{}' > /app/data/user-db.json \
  && echo '{}' > /app/data/available-channels.json

CMD ["node", "dist/start.js"]
