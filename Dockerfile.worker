# Worker + reaper image (спец v2.1 §5.1). Same image, different command:
#   worker:  npx tsx adorable/worker/index.ts
#   reaper:  npx tsx adorable/reaper/index.ts
#
# Runs the TypeScript entrypoints directly with tsx (handles ESM + import.meta +
# the @/ alias) — no separate compile step. docker.sock is bind-mounted at
# runtime for the dockerode-managed sandbox containers.

FROM node:22-alpine AS base
WORKDIR /app
RUN apk add --no-cache wget docker-cli

FROM base AS deps
COPY package.json package-lock.json ./
COPY adorable/package.json ./adorable/package.json
RUN npm ci --workspaces --include-workspace-root

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY . .
WORKDIR /app/adorable
EXPOSE 8080
# command is overridden per-service in docker-compose (worker vs reaper).
CMD ["npx", "tsx", "worker/index.ts"]
