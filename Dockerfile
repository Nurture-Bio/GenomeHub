FROM node:22-alpine AS base
WORKDIR /app

# ── Install all deps ──────────────────────────────────────
FROM base AS deps
COPY package*.json ./
COPY packages/client/package*.json  ./packages/client/
COPY packages/server/package*.json  ./packages/server/
RUN npm ci --workspaces --if-present

# ── Build client ──────────────────────────────────────────
FROM deps AS build-client
COPY packages/client/ ./packages/client/
RUN npm run build -w packages/client

# ── Build server ──────────────────────────────────────────
FROM deps AS build-server
COPY packages/server/ ./packages/server/
RUN npm run build -w packages/server

# ── Production image ──────────────────────────────────────
FROM node:22-alpine AS production
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build-server /app/packages/server/dist  ./packages/server/dist
COPY --from=build-client /app/dist/client           ./dist/client
COPY package*.json ./
COPY packages/server/package*.json ./packages/server/
RUN npm ci --workspaces --if-present --omit=dev

EXPOSE 3000
CMD ["node", "packages/server/dist/server.js"]
