# Build-runner image для static preview-режима.
#
# Архитектура: ephemeral docker container, запускается на каждый билд.
# Содержит фиксированный набор boilerplate-файлов (package.json,
# vite.config.js, tailwind/postcss config, index.html, jsconfig.json,
# functions/tsconfig.json) на /workspace/. Из node_modules собран
# отдельный named volume, монтируется в контейнер RO.
#
# Source: docs/preview-provider/BUILD_PIPELINE.md §4.2,
#         docs/preview-provider/BOILERPLATE.md §1, ADR-005.
#
# Image tag: build-runner-react:<boilerplateVersion> (читается из
# templates/vite-react/VERSION).
#
# ASSUMPTION: используем npm + package-lock.json, потому что текущий
# templates/vite-react/ не содержит pnpm-lock.yaml. Спека ссылается на
# pnpm; переход на pnpm — open question (требует ADR + загрузка lock'а).
# До того как это случится — npm install отрабатывает корректно.

ARG NODE_VERSION=22
FROM node:${NODE_VERSION}-slim AS deps

ENV CI=1
ENV NODE_ENV=development

# Системные deps — нужны только для опциональных native-сборок (sharp,
# canvas и т.п.). Если в будущем boilerplate их добавит — раскомментить.
# На MVP список зависимостей чисто JS.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

WORKDIR /workspace

# Сначала только manifest — кешируется до тех пор, пока deps не
# меняются. На каждый bump VERSION manifest гарантированно меняется
# (см. BOILERPLATE §3) → cache miss → rebuild deps.
COPY templates/vite-react/package.json templates/vite-react/package-lock.json* ./

# Если package-lock.json есть — `npm ci` (детерминированно). Если
# нет — fallback на `npm install` (для текущего шаблона без lock).
RUN if [ -f package-lock.json ]; then \
      npm ci --no-audit --no-fund; \
    else \
      npm install --no-audit --no-fund; \
    fi

# Копируем фиксированные boilerplate-файлы.
COPY templates/vite-react/vite.config.js ./
COPY templates/vite-react/tailwind.config.js ./
COPY templates/vite-react/postcss.config.js ./
COPY templates/vite-react/jsconfig.json ./
COPY templates/vite-react/index.html ./

# functions/tsconfig.json (ADR-021) — если уже есть. На MVP файл
# может отсутствовать; вторым копированием обеспечиваем noop.
RUN mkdir -p functions
COPY templates/vite-react/functions/tsconfig.json functions/tsconfig.json

# Pin VERSION в образ — чтобы build-runner мог отрепортить какую
# версию boilerplate'а он выполняет. Используется в audit-log.
COPY templates/vite-react/VERSION ./VERSION

# init-volume.sh — фиксирует node_modules в named volume при первом
# запуске. Лежит в scripts/build-runner/ (внутри build-context = adorable/),
# в образ кладётся в /workspace/init-volume.sh — то место, на которое
# ссылается контракт запуска (-u 0:0 entrypoint sh /workspace/init-volume.sh).
COPY scripts/build-runner/init-volume.sh /workspace/init-volume.sh
RUN chmod 0755 /workspace/init-volume.sh

# ---------------------------------------------------------------------------
# Runtime stage.
#
# Один и тот же image и для build, и для init-volume — внутри один
# набор пакетов. init-volume.sh запускается с CMD override.
# ---------------------------------------------------------------------------

FROM deps AS runtime

# Non-root user (BUILD_PIPELINE §4.2 — User: "1000:1000").
# Linux base "node" image уже создаёт user `node` с UID 1000 — переиспользуем.
USER 1000:1000

# По-умолчанию — vite build. CMD переопределяется на init-volume.sh
# когда мы первый раз заполняем named volume node_modules.
CMD ["npx", "vite", "build"]
