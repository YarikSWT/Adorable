#!/usr/bin/env sh
# init-volume.sh — однократно заполняет named volume
# `adorable_node_modules_react_<version>` содержимым
# `/workspace/node_modules` из build-runner image'а.
#
# Source: docs/preview-provider/BOILERPLATE.md §5,
#         docs/preview-provider/BUILD_PIPELINE.md §4.2, ADR-005.
#
# Контракт запуска:
#   docker run --rm \
#     -v adorable_node_modules_react_<v>:/mnt/dest \
#     build-runner-react:<v> /workspace/init-volume.sh
#
# Сценарий:
#   1. Если /mnt/dest пустой — копируем рекурсивно.
#   2. Если в /mnt/dest уже что-то есть — это либо partial-fill после
#      предыдущего падения, либо новая версия пытается заехать в
#      старый volume. В обоих случаях останавливаемся с ненулевым
#      exit-code, чтобы platform-engineer вмешался.
#
# `cp -a` сохраняет симлинки (важно для pnpm-style node_modules; для
# npm они появляются у вложенных bin-зависимостей).

set -eu

DEST=/mnt/dest
SRC=/workspace/node_modules

if [ ! -d "$SRC" ]; then
  echo "init-volume: $SRC does not exist; build-runner image is broken." >&2
  exit 2
fi

# Detect non-empty destination — refuse to overwrite.
if [ -n "$(ls -A "$DEST" 2>/dev/null || true)" ]; then
  echo "init-volume: $DEST is not empty; refusing to overwrite." >&2
  echo "If this is intentional, recreate the volume:" >&2
  echo "  docker volume rm <volume-name> && docker volume create <volume-name>" >&2
  exit 3
fi

VERSION="$(cat /workspace/VERSION 2>/dev/null || echo unknown)"
echo "init-volume: filling $DEST from $SRC (boilerplate=$VERSION)..."

cp -a "$SRC"/. "$DEST"/

echo "init-volume: done."
