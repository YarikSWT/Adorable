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
#     -u 0:0 \
#     -v adorable_node_modules_react_<v>:/mnt/dest \
#     --entrypoint sh build-runner-react:<v> \
#     /workspace/init-volume.sh
#
# Обязательно `-u 0:0`: docker создаёт fresh named volume с
# `/mnt/dest` под root'ом, поэтому writable cp -a возможен только
# из root'а. После заливки скрипт делает `chown -R 1000:1000` чтобы
# build-runner процесс (USER 1000:1000) мог читать содержимое.
#
# Сценарий:
#   1. Если /mnt/dest пустой — копируем рекурсивно, потом chown.
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
TARGET_UID=1000
TARGET_GID=1000

# Hard-require root: see header comment. We chown after cp so the
# main build-runner user (1000:1000) can read the volume.
if [ "$(id -u)" -ne 0 ]; then
  echo "init-volume: must run as root (use docker run -u 0:0)." >&2
  echo "init-volume: current uid=$(id -u) cannot write to a freshly-created volume." >&2
  exit 4
fi

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

# Hand the volume over to the non-root build-runner user. Without this
# the runtime container (USER 1000:1000) gets EACCES on the read-only
# mount because /mnt/dest itself is still root-owned.
chown -R "$TARGET_UID:$TARGET_GID" "$DEST"

echo "init-volume: done."
