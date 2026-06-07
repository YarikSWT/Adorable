# Образ билдера Adorable для prod-симуляции через docker-compose.prod.yml.
# В dev билдер запускается локально через `npm run dev`.

FROM node:22-slim AS base
ENV NODE_ENV=production
ENV CI=1
WORKDIR /app

# System deps:
#  - curl/wget для health checks + init-gitea
#  - ruby + kamal для Phase 5 deploy
#  - openssl для генерации секретов
#  - docker-cli для взаимодействия с пробрасываемым хостовым сокетом
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates \
      curl \
      wget \
      openssl \
      ruby \
      ruby-dev \
      build-essential \
      git \
      docker-cli \
    && gem install kamal --version '~> 2.3' --no-document \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

FROM base AS deps
COPY package.json package-lock.json ./
COPY adorable/package.json ./adorable/package.json
COPY adorable/package-lock.json ./adorable/package-lock.json
RUN npm ci --workspaces --include-workspace-root

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/adorable/node_modules ./adorable/node_modules
COPY . .
RUN npm run build

FROM base AS runtime
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/adorable/node_modules ./adorable/node_modules
COPY --from=build /app/adorable/.next ./adorable/.next
COPY --from=build /app/adorable/public ./adorable/public 2>/dev/null || true
COPY package.json package-lock.json ./
COPY adorable/package.json adorable/package.json
COPY adorable/next.config.ts adorable/next.config.ts
COPY adorable/app ./adorable/app
COPY adorable/components ./adorable/components
COPY adorable/hooks ./adorable/hooks
COPY adorable/lib ./adorable/lib
COPY config ./config
COPY scripts ./scripts

# non-root user
RUN groupadd -g 1001 adorable && useradd -u 1001 -g adorable -m adorable
USER adorable

EXPOSE 3000
CMD ["npm", "run", "start"]
