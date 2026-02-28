FROM node:22-alpine AS base
WORKDIR /app

# ── Install all deps ──────────────────────────────────────
FROM base AS deps
COPY package*.json ./
COPY packages/shared/package*.json ./packages/shared/
COPY packages/client/package*.json  ./packages/client/
COPY packages/server/package*.json  ./packages/server/
RUN npm ci --workspaces --if-present

# ── Build shared package ─────────────────────────────────
FROM deps AS build-shared
COPY packages/shared/ ./packages/shared/
RUN npm run build -w packages/shared

# ── Build client ──────────────────────────────────────────
FROM build-shared AS build-client
ARG VITE_GOOGLE_CLIENT_ID
ENV VITE_GOOGLE_CLIENT_ID=${VITE_GOOGLE_CLIENT_ID}
COPY vendor/strand/   ./vendor/strand/
COPY packages/strand/ ./packages/strand/
COPY packages/client/ ./packages/client/
COPY .env.example ./.env
RUN npm run build -w packages/client

# ── Build server ──────────────────────────────────────────
FROM build-shared AS build-server
COPY packages/server/ ./packages/server/
RUN npm run build -w packages/server

# ── Production image ──────────────────────────────────────
FROM node:22-alpine AS production
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build-server /app/packages/server/dist  ./packages/server/dist
COPY --from=build-server /app/packages/server/src/migrations  ./packages/server/migrations
COPY --from=build-client /app/dist/client           ./dist/client
COPY --from=build-shared /app/packages/shared/dist  ./packages/shared/dist
COPY package*.json ./
COPY packages/shared/package*.json ./packages/shared/
COPY packages/server/package*.json ./packages/server/
RUN npm ci --workspaces --if-present --omit=dev

EXPOSE 3000
CMD ["node", "packages/server/dist/server.js"]
