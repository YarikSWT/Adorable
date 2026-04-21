#!/usr/bin/env bash
# Управление инфра-контейнерами Adorable fork.
# Usage: scripts/dev-infra.sh up | down | logs | status | wait-healthy

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

cmd="${1:-up}"

case "$cmd" in
  up)
    docker compose up -d
    echo "→ Infra starting. Ждите health-checks. Используйте: scripts/dev-infra.sh wait-healthy"
    ;;
  down)
    docker compose down
    ;;
  logs)
    shift || true
    docker compose logs -f "$@"
    ;;
  status)
    docker compose ps
    ;;
  wait-healthy)
    # Подождать пока все сервисы перейдут в healthy.
    echo "→ Ожидание healthy статуса для всех сервисов..."
    for i in {1..60}; do
      unhealthy=$(docker compose ps --format json 2>/dev/null | \
        awk 'BEGIN{RS="\n"} /"Health":/ && !/\"healthy\"/ && !/\"\"/ {c++} END{print c+0}')
      starting=$(docker compose ps --format json 2>/dev/null | grep -c '"Health":"starting"' || true)
      if [ "${unhealthy:-0}" -eq 0 ] && [ "${starting:-0}" -eq 0 ]; then
        echo "→ Все сервисы healthy."
        docker compose ps
        exit 0
      fi
      sleep 2
    done
    echo "⚠️  Timeout ожидания. Текущее состояние:"
    docker compose ps
    exit 1
    ;;
  init-gitea)
    exec "$ROOT_DIR/scripts/init-gitea.sh"
    ;;
  *)
    echo "usage: $0 {up|down|logs|status|wait-healthy|init-gitea}" >&2
    exit 2
    ;;
esac
