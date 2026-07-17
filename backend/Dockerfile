# syntax=docker/dockerfile:1

FROM node:22-alpine AS base
WORKDIR /app
# Prisma's query engine needs OpenSSL on Alpine.
RUN apk add --no-cache openssl

# ---- deps: install full (dev + prod) dependencies for building ----
FROM base AS deps
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/package.json
RUN npm ci --workspace=@flowforge/backend --include-workspace-root

# ---- build: generate Prisma client and compile TypeScript ----
FROM deps AS build
COPY tsconfig.base.json ./tsconfig.base.json
COPY backend ./backend
RUN npm run --workspace=@flowforge/backend prisma:generate
RUN npm run --workspace=@flowforge/backend build

# ---- prod-deps: production-only dependencies, with Prisma client generated ----
FROM base AS prod-deps
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/package.json
RUN npm ci --workspace=@flowforge/backend --include-workspace-root --omit=dev
COPY backend/prisma ./backend/prisma
RUN npm run --workspace=@flowforge/backend prisma:generate

# ---- runtime: minimal image with only what's needed to run ----
FROM base AS runtime
ENV NODE_ENV=production
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/backend/dist ./backend/dist
COPY backend/package.json ./backend/package.json
COPY backend/prisma ./backend/prisma

WORKDIR /app/backend
EXPOSE 3000
CMD ["node", "dist/main.js"]
