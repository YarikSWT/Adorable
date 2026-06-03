# Security Model

Этот документ описывает модель угроз self-hosted Adorable форка и меры,
которые реализованы для их митигации.

## Контекст

Adorable-билдер принимает пользовательские промпты и позволяет AI (GLM)
генерировать и исполнять код внутри sandbox-контейнеров. Без защиты
это прямой путь к RCE на хосте. Поэтому Phase 2 — самая важная часть
миграции, а её security-тесты — обязательный gate.

## Доверительные границы

```
[user browser] ──https──> [builder (Next.js)]
                               │
                   ┌───────────┼───────────┐
                   ▼           ▼           ▼
               [Gitea]      [Docker]    [Caddy]
                                           │
                                           ▼
                              [sandbox container]
                              ← полностью непривилегирован
```

**Доверяем:** builder-процесс (он под нашим контролем), инфраструктуру
(Postgres, Gitea, Caddy в изолированной сети `adorable_infra`).

**Не доверяем:** содержимое sandbox-контейнеров. Всё что бежит там —
произведено AI либо пользователем, ему нельзя дать:
- доступ к хост-файловой системе
- escape привилегий
- сеть за пределы собственной sandbox-сети
- Docker daemon
- неограниченные ресурсы (DoS)

## Меры (Phase 2 sandbox)

Каждый sandbox-контейнер создаётся с 15 обязательными ограничениями
(см. `lib/adapters/sandbox-docker-config.ts`):

| # | Мера | Docker config | Защищает от |
|---|---|---|---|
| 1 | CPU limit | `HostConfig.NanoCpus` | CPU-DoS |
| 2 | Memory limit | `HostConfig.Memory` | RAM-exhaustion |
| 3 | Swap off | `HostConfig.MemorySwap === Memory` | Swap flood |
| 4 | PIDs limit | `HostConfig.PidsLimit` | Fork bomb |
| 5 | Read-only rootfs | `HostConfig.ReadonlyRootfs: true` | Modification of system files |
| 6 | no-new-privileges | `HostConfig.SecurityOpt: ["no-new-privileges:true"]` | setuid escape |
| 7 | Drop all capabilities | `HostConfig.CapDrop: ["ALL"]` | Kernel-level privesc |
| 8 | Non-root user | `Config.User: "1000:1000"` | Root in container |
| 9 | ulimits | `HostConfig.Ulimits` (nofile, core=0) | FD exhaustion + core dumps |
| 10 | Storage limit (optional) | `HostConfig.StorageOpt.size` | Disk fill |
| 11 | Block I/O limits (optional) | `HostConfig.BlkioDevice{Read,Write}Bps` | I/O DoS |
| 12 | Custom network | `HostConfig.NetworkMode: adorable_sandboxes` (rejects host/bridge) | Network pivoting |
| 13 | Managed lifecycle | Cleanup worker (TTL + idle) | Resource leak |
| 14 | Tmpfs /tmp + /workspace | `HostConfig.Tmpfs` с nosuid,nodev,size,mode,uid,gid | Privilege escalation via setuid bins + workspace writes |
| 15 | Structured audit log | `SANDBOX_AUDIT_LOG` | Forensics / billing |

## Тесты, которые проверяют это в рантайме

`tests/sandbox-security.test.ts` (gated `RUN_DOCKER_TESTS=1`, 9 тестов, все зелёные):

- `containerHasCpuLimit` — docker inspect видит NanoCpus > 0
- `containerHasMemoryLimit` — Memory > 0 и MemorySwap == Memory
- `containerCannotEscapeMemory` — dd overshoot → OOM-kill
- `containerCannotForkBomb` — PidsLimit → "Cannot fork"
- `containerCannotEscalatePrivileges` — uid=1000, `sudo` не найдена, `su` denied
- `containerCannotWriteOutsideVolumes` — ReadonlyRootfs блокирует `/etc/passwd`, tmpfs workspace пишется
- `containerCannotAccessHostDocker` — `/var/run/docker.sock` отсутствует
- `containerNetworkIsolation` — `host.docker.internal:2375` не достижим
- `containerLifecycleEnforced` — cleanup-worker удаляет просроченный sandbox

## Меры (Phase 4 proxy / Caddy)

1. **Caddy Admin API не проброшен наружу.** Docker-compose маппит
   `127.0.0.1:2019:2019` — admin API не слушает на публичных адресах.
   Внутри контейнера Caddy привязан к `0.0.0.0:2019`, но host binding
   localhost-only, поэтому с внешки он недоступен.
2. **Роуты идемпотентны.** `PATCH /id/<@id>` replaces in place; POST
   используется только когда @id ещё не зарегистрирован. Двойной
   `addRoute` с одним id не создаёт дубль.
3. **Каскад при destroy sandbox.** Cleanup-worker при reap инжектит
   `proxy.removeSandboxRoutes(sandboxId)` → все route с этим sandboxId
   удаляются атомарно с контейнером.
4. **Audit log.** Каждое add/remove пишется в `SANDBOX_AUDIT_LOG` с
   hostname + upstream + sandboxId.

## Проверки в `tests/proxy-*`

- `proxy-contract.test.ts` (9 unit, всегда): idempotent, remove,
  removeSandboxRoutes cascade.
- `proxy-security.test.ts` (3 unit): sandboxLifecycleSyncsProxy,
  сохранение routes для других sandbox, admin-api host-bind expectation.
- `proxy-caddy-integration.test.ts` (6, gated `RUN_CADDY_TESTS=1`):
  health, add+list, idempotent, remove, idempotent-remove, removeSandboxRoutes.

## Меры (Phase 3 git / Gitea)

- `GITEA_TOKEN` хранится только в `.env` builder-процесса; на клиенте
  никогда не попадает.
- Push-mirror для GitHub sync использует HTTPS URL без credentials
  (требует публичный read-only mirror настроенный в GitHub app).
- Gitea привязан к `127.0.0.1:${GITEA_HOST_PORT}` (default 3001, на
  этом dev-хосте 3011) — не публичный.

## Меры (LLM provider)

- API-ключи через env (`Z_AI_API_KEY`, `OPENROUTER_API_KEY`,
  `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`). Никогда не передаются клиенту.
- Альтернатива: user-supplied API key через cookie (`user-api-key`,
  `user-api-provider`) — используется только если global env key не задан.
  Cookie httpOnly, не доступна из frontend JS.

## Аутентификация / идентификация

Текущая реализация (MVP): cookie `adorable_identity_id` с httpOnly UUID.
Per-identity репо-permissions хранятся в памяти процесса. Это приемлемо
для single-host single-user dev-деплоя. Для prod-деплоя с несколькими
пользователями см. ADR-015: миграция на Better Auth с Postgres.

## Остаточные риски

- **Docker socket в builder.** Phase 2 ADR-007 признаёт это как MVP.
  Для multi-tenant scale требуется отдельный Docker-host под sandbox,
  builder ходит по TCP+TLS. Текущая конфигурация НЕ подходит для
  публичного мультипользовательского сервиса без этой доработки.
- **Identity в памяти.** Рестарт builder сбрасывает все ACL. Для
  production замена на Better Auth + Postgres обязательна.
- **Sandbox-to-sandbox network.** В текущей конфигурации sandbox'ы
  в одной сети `adorable_sandboxes` могут общаться друг с другом.
  Network isolation test проверяет только что sandbox не достаёт
  до host — per-sandbox network namespace — задача v2.
- **Secrets в audit log.** Audit log пишет команды exec; если AI
  встроит secret в команду, он попадёт в лог. Файл должен быть
  защищён ФС-правами (0600) и ротироваться.

## Процесс фиксации блокеров

При любом провале security-теста:
1. Запись в `SECURITY_BLOCKERS.md` с симптомом и планом.
2. Пометка соответствующей задачи в `MIGRATION_PLAN.md` как `[!]`.
3. Phase 2 не закрывается (и промис `FORK_MIGRATION_COMPLETE` не выдаётся)
   пока SECURITY_BLOCKERS.md содержит активные блокеры.
