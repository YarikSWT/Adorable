#!/usr/bin/env bash
# Инициализация Gitea: создание admin-пользователя и генерация API-токена.
# Идемпотентен: повторные запуски не создают дубликатов.
#
# Писать токен в .env можно указав флаг --write-env.
# Пример: scripts/init-gitea.sh --write-env

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

WRITE_ENV=0
for arg in "$@"; do
  case "$arg" in
    --write-env) WRITE_ENV=1 ;;
    -h|--help)
      cat <<EOF
Usage: $0 [--write-env]
  --write-env   Записать GITEA_TOKEN в .env после создания.
EOF
      exit 0
      ;;
  esac
done

# Читаем .env для креденшелов.
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . .env
  set +a
fi

GITEA_ADMIN_USER="${GITEA_ADMIN_USER:-adorable}"
GITEA_ADMIN_EMAIL="${GITEA_ADMIN_EMAIL:-admin@adorable.local}"
GITEA_ADMIN_PASSWORD="${GITEA_ADMIN_PASSWORD:-}"
GITEA_BASE_URL="${GITEA_BASE_URL:-http://localhost:3001}"

if [ -z "$GITEA_ADMIN_PASSWORD" ]; then
  echo "→ GITEA_ADMIN_PASSWORD пустой, генерируем..."
  GITEA_ADMIN_PASSWORD="$(openssl rand -base64 24 | tr -d '\n')"
  if [ "$WRITE_ENV" -eq 1 ]; then
    # shellcheck disable=SC2016
    if grep -q '^GITEA_ADMIN_PASSWORD=' .env 2>/dev/null; then
      sed -i.bak "s|^GITEA_ADMIN_PASSWORD=.*|GITEA_ADMIN_PASSWORD=$GITEA_ADMIN_PASSWORD|" .env
      rm -f .env.bak
    else
      echo "GITEA_ADMIN_PASSWORD=$GITEA_ADMIN_PASSWORD" >> .env
    fi
  fi
  echo "→ Пароль: $GITEA_ADMIN_PASSWORD"
fi

# Ждём чтобы Gitea был готов.
echo "→ Ждём Gitea на $GITEA_BASE_URL/api/healthz..."
for i in {1..60}; do
  if curl -fsS "$GITEA_BASE_URL/api/healthz" >/dev/null 2>&1; then
    echo "→ Gitea готов."
    break
  fi
  sleep 2
  if [ "$i" -eq 60 ]; then
    echo "❌ Gitea не готов после 120s"
    exit 1
  fi
done

# Создание admin-пользователя через gitea CLI внутри контейнера.
# `|| true` потому что повторный запуск конфликтует — это OK.
echo "→ Создаём admin-пользователя '$GITEA_ADMIN_USER'..."
if docker compose exec -T -u git gitea \
    gitea admin user create \
      --admin \
      --username "$GITEA_ADMIN_USER" \
      --password "$GITEA_ADMIN_PASSWORD" \
      --email "$GITEA_ADMIN_EMAIL" \
      --must-change-password=false 2>&1 | tee /tmp/gitea-create.log; then
  echo "→ Admin создан."
else
  if grep -qi 'already exists' /tmp/gitea-create.log; then
    echo "→ Admin уже существует."
  else
    echo "❌ Не удалось создать admin"
    exit 1
  fi
fi

# Попробуем залогиниться чтобы убедиться в корректности пароля (basic auth).
http_code=$(curl -o /dev/null -s -w '%{http_code}' -u "$GITEA_ADMIN_USER:$GITEA_ADMIN_PASSWORD" \
  "$GITEA_BASE_URL/api/v1/user")
if [ "$http_code" != "200" ]; then
  echo "❌ Basic auth не прошёл (HTTP $http_code). Проверьте GITEA_ADMIN_PASSWORD в .env — он должен совпадать с текущим паролем админа в Gitea."
  exit 1
fi

# Создаём (или находим) токен.
TOKEN_NAME="adorable-builder"
echo "→ Проверяем токен '$TOKEN_NAME'..."

existing_tokens=$(curl -fsS -u "$GITEA_ADMIN_USER:$GITEA_ADMIN_PASSWORD" \
  "$GITEA_BASE_URL/api/v1/users/$GITEA_ADMIN_USER/tokens")

if echo "$existing_tokens" | grep -q "\"name\":\"$TOKEN_NAME\""; then
  echo "→ Токен '$TOKEN_NAME' уже существует. Удаляем чтобы пересоздать (значение видно только при создании)."
  # Gitea DELETE /users/{username}/tokens/{token} принимает и ID, и имя — используем имя, это проще и всегда уникально.
  if ! curl -fsS -u "$GITEA_ADMIN_USER:$GITEA_ADMIN_PASSWORD" -X DELETE \
      "$GITEA_BASE_URL/api/v1/users/$GITEA_ADMIN_USER/tokens/$TOKEN_NAME" >/dev/null; then
    echo "❌ Не удалось удалить существующий токен. Удалите вручную через Gitea UI и перезапустите."
    exit 1
  fi
fi

echo "→ Создаём новый токен..."
token_response=$(curl -fsS -u "$GITEA_ADMIN_USER:$GITEA_ADMIN_PASSWORD" -X POST \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"$TOKEN_NAME\",\"scopes\":[\"write:repository\",\"write:user\",\"write:admin\"]}" \
  "$GITEA_BASE_URL/api/v1/users/$GITEA_ADMIN_USER/tokens")

GITEA_TOKEN=$(echo "$token_response" | node -e "
  let data=''; process.stdin.on('data', c => data+=c); process.stdin.on('end', () => {
    const obj = JSON.parse(data);
    process.stdout.write(String(obj.sha1 || ''));
  });
")

if [ -z "$GITEA_TOKEN" ]; then
  echo "❌ Не удалось получить sha1 токена из ответа:"
  echo "$token_response"
  exit 1
fi

echo "→ Токен создан: ${GITEA_TOKEN:0:8}…"

if [ "$WRITE_ENV" -eq 1 ]; then
  # shellcheck disable=SC2016
  if grep -q '^GITEA_TOKEN=' .env 2>/dev/null; then
    sed -i.bak "s|^GITEA_TOKEN=.*|GITEA_TOKEN=$GITEA_TOKEN|" .env
    rm -f .env.bak
  else
    echo "GITEA_TOKEN=$GITEA_TOKEN" >> .env
  fi
  echo "→ GITEA_TOKEN записан в .env"
else
  echo
  echo "Добавьте в .env:"
  echo "GITEA_TOKEN=$GITEA_TOKEN"
fi
