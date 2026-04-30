# MONITORING.md — алерты и runbook для static-mode preview

Документ описывает что мониторить, какие пороги триггерят страницу
on-call'а, и что делать когда конкретный алерт сработал. Источник —
`STATIC_MODE_REMAINING.md` §11 + `MIGRATION_PATH.md` §6.

## Метрики и пороги

| Сигнал                          | Окно   | PAGE if         | WARN if          |
|---------------------------------|--------|-----------------|------------------|
| `build_finished` success-rate   | 1 час  | < 95% (n ≥ 20)  | < 98% (n ≥ 20)   |
| `build_runner_killed_timeout`   | 1 час  | ≥ 5 событий    | ≥ 1 событие     |
| `auth_denied`                   | 1 час  | ≥ 50 событий   | ≥ 5 событий     |
| `upload_rejected`               | 1 час  | —              | ≥ 5 событий     |
| `path_rejected`                 | 1 час  | —              | ≥ 5 событий     |
| Audit log malformed lines       | 24 час | —              | ≥ 1 строка      |

Threshold-defaults захардкожены в
`adorable/lib/bench/audit-summary.ts:DEFAULT_THRESHOLDS` —
`buildSuccessRateMin: 0.95`, `minSamples: 20`,
`killedByTimeoutMax: 5`, `authDeniedMax: 50`. Все три — стартовые
значения; tuning после первой недели на staging'е.

## Как проверить вручную

`scripts/audit-summary.ts` — pure-helper'ы инсайде унит-тестированы,
script делает всё вычисление за один проход:

```bash
# Полный лог
npx tsx scripts/audit-summary.ts --file /var/log/adorable/audit.log

# Последний час
npx tsx scripts/audit-summary.ts --file /var/log/adorable/audit.log \
  --since "$(date -u -d '1 hour ago' +%FT%TZ)"

# С JSON output для дальнейшей обработки
npx tsx scripts/audit-summary.ts --file /var/log/adorable/audit.log --json

# Через stdin (например после tail или kubectl logs)
kubectl logs -l app=adorable | npx tsx scripts/audit-summary.ts --stdin
```

Exit code:
- `0` — всё ок (или только WARN-уровень алерты)
- `10` — есть PAGE-уровень алерт; можно дёрнуть on-call hook

## Runbook по алертам

### `build_success_rate` (PAGE)

**Что значит:** `succeeded / finished < 95%` за час, при минимум 20 законченных билдов. Реальная регрессия в build pipeline.

**Triage:**
1. `audit-summary --since 1h` чтобы увидеть распределение `build_finished.status`.
2. Открыть Caddy/Gitea логи параллельно, проверить нет ли network
   проблем (если оба источника жалуются — проблема инфры, не пайплайна).
3. Из failed `build_finished` вытащить `jobId` и поднять в audit-log
   соответствующий `build_started` + контекст:
   ```bash
   grep '"jobId":"<id>"' /var/log/adorable/audit.log
   ```
4. Если `errorsCount > 0` — это валидная build-error от парсера,
   проблема в коде проекта, **не алерт-достойно** (фейлы по причине
   user-кода ожидаемы). В этом случае пересмотреть пороги.
5. Если `exitCode === 137` (OOM или KILL) — связано с
   `build_runner_killed_timeout` (см. ниже).

**Возможные причины:**
- Регрессия в `build-runner-react` image (после bump'а
  `boilerplateVersion` не пересобрали volume — миграционный воркер не
  отработал).
- Сломанный bind-mount (Caddy vs Node FS desync — см. ADR-031).
- Полный диск на хосте (`STATIC_ROOT` partition).

**Mitigation:**
- `PREVIEW_PROVIDER_FORCE_SANDBOX=1` (см. README §3 emergency rollback)
  для **новых** проектов; existing проекты остаются в static.
- Per-project recovery (после фикса) — `migrate-repo-to-static.ts`.

### `build_runner_killed_timeout` (PAGE)

**Что значит:** ≥5 build-runner контейнеров за час превысили
`BUILD_RUNNER_TIMEOUT_MS` (default 120 сек). Симптом — build hangs;
docker daemon под нагрузкой; зависший vite процесс.

**Triage:**
1. `docker ps -a --filter "name=build-runner-"` — есть ли уцелевшие
   контейнеры (не должно быть после ADR + force-remove из commit
   `67e8cf2`)?
2. `docker stats` под нагрузкой — может ли build-runner получить
   2 GiB / 2 cores (defaults) или хост перегружен?
3. `audit-summary --since 1h` — сколько именно `build_finished.exitCode == 137`?
4. Проверить что `BUILD_WAIT_DEADLINE_BUFFER_MS` достаточен (default
   5000 ms) — на медленном докер-демоне может быть мало.

**Возможные причины:**
- Превышение `BUILD_RUNNER_TIMEOUT_MS` из-за легитимного тяжёлого билда
  (огромный проект). На MVP таких быть не должно.
- Docker daemon под нагрузкой (дополнительные builds + sandboxes
  параллельно). Решается лимитом concurrency в BuildQueue (max 1
  running).
- Зависший Vite (бесконечный плагин-loop). Workaround: kill — мы это
  делаем; долгосрочно — отрезать плагин.

**Mitigation:**
- Поднять `BUILD_RUNNER_TIMEOUT_MS` если это лож-positive.
- Уменьшить параллельность в `BuildQueue` (поправить max в singleton).
- Сбросить docker daemon (rolling rotate node'ов).

### `auth_denied` (PAGE)

**Что значит:** ≥50 событий за час — потенциально brute-force на
identity-session или сканер атакующий рандомные routes.

**Triage:**
1. `grep '"event":"auth_denied"' /var/log/adorable/audit.log | jq -r '.identityId' | sort | uniq -c | sort -rn | head`
   — кто именно атакует.
2. Проверить geo-распределение source IP'ов через access-log Caddy
   (audit-log сам не пишет IP — это в Caddy'i).
3. Если source — один identityId — глянуть последние действия этого
   identity'а: возможно bug, не атака.

**Mitigation:**
- Rate-limit на Caddy уровне для source IP.
- Revoke identitySession если идентифицирован атакующий.

### `path_rejected` / `upload_rejected` (WARN)

**Что значит:** LLM пытается писать вне whitelist, либо клиент
отправляет некорректный upload. Не PAGE — это **ожидаемые** rejections
в нормальной эксплуатации (LLM-tool сейф, validators работают).

**Triage:**
- Если `path_rejected` зашкаливает (>50/час за один проект) — возможно
  LLM скатился в loop. Открыть audit-log по этому projectId, посмотреть
  паттерн.
- Если `upload_rejected` зашкаливает — клиент сломан или reproducer'ы
  атакуют. Проверить header'ы / mime-types которые отбраковываются.

### `malformed_lines` (WARN)

**Что значит:** в audit-log нашлись строки которые не парсятся как
JSON. audit-log пишется через `appendAuditLog` атомарно — обычно
malformed = result truncate'а или прямого редактирования.

**Triage:**
- `tail -n 1000 /var/log/adorable/audit.log | head -n 5` — посмотреть
  что там.
- Если truncate — проверить disk usage, log rotation.
- Если ручное редактирование — выяснить кто/зачем; обычно это
  непреднамеренное.

## Как алерт автоматизируется (не реализовано)

Spec предлагает Vector / Fluent Bit + Loki + Grafana, но это —
infra-задача после prod-deploy. Минимальный starter без новой
инфраструктуры:

```bash
# cron, каждые 5 минут на хосте с adorable
*/5 * * * * cd /opt/adorable && \
  npx tsx scripts/audit-summary.ts \
    --file /var/log/adorable/audit.log \
    --since "$(date -u -d '5 minutes ago' +%FT%TZ)" \
    --json > /tmp/audit-5min.json && \
  if [ $? -eq 10 ]; then \
    curl -X POST -d @/tmp/audit-5min.json $PAGER_WEBHOOK_URL; \
  fi
```

Это даёт первичный сигнал в pager без Loki/Grafana. Production-grade
— через log shipper + Grafana panels поверх loki dataset'а.

---

_Last updated: 2026-04-30 — file created. Thresholds untuned (no production data yet)._
