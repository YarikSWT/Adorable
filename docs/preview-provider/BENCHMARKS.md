# BENCHMARKS.md — фактические p50/p95/p99 для static-mode

Этот документ — append-only отчёт по нагрузочным тестам, требуемым в
`MIGRATION_PATH.md` §6 (acceptance перед default-switch'ем) и
`STATIC_MODE_REMAINING.md` §10. Цели по перцентилям зафиксированы в
`VERIFICATION.md` §3.

| Метрика                     | Цель           |
|-----------------------------|----------------|
| Cold build (новый проект, первый build)         | p50 < 30s, p95 < 60s |
| Warm build (incremental, deps cached)           | p50 < 10s, p95 < 20s |
| End-to-end turn (chat → preview update)         | p50 < 60s, p95 < 120s |
| Success rate за 24ч                              | > 95% |
| Volume size `adorable_node_modules_react_*`     | < 500 MB |
| Memory peak build-runner                         | < 1.5 GB |

---

## Как воспроизвести

### Warm-build benchmark (нагрузочный)

```bash
# adorable instance must be running with PREVIEW_PROVIDER=static.
# Existing static project p-<id> required (use POST /api/repos to create
# one if needed).

npx tsx scripts/bench-static-build.ts \
  --project p-<id> \
  --base-url http://localhost:3000 \
  --audit-log /var/log/adorable/audit.log \
  --iterations 100 \
  --concurrency 1 \
  --json
```

Скрипт ([`scripts/bench-static-build.ts`](../../adorable/scripts/bench-static-build.ts)):
1. Делает `POST /api/projects/<id>/rebuild` N раз (последовательно либо
   с `--concurrency`).
2. Поллит `GET /api/projects/<id>/build-status` пока каждый job не
   попадёт в terminal status.
3. Читает audit-log, фильтрует `build_finished` events во временном
   окне benchmark'а.
4. Печатает count / success rate / min / p50 / p95 / p99 / max / mean.

Pure-helper'ы (`lib/bench/percentiles.ts`) покрыты unit-тестами в
`tests/bench-percentiles.test.ts` — math корректность гарантирована
до запуска на staging'е.

### Cold-build benchmark

Cold build = первый build после `POST /api/repos`. Замеряется отдельно,
потому что:

- В cold build входит `previewProvider.create()` (scratch dir,
  initial-write metadata.json).
- Vite bundle cache холодный — нет `.vite/deps`.
- node_modules volume already populated (см. ADR-005), но dedupe-cache
  холодный.

Для замера cold build cделать N pairs:

```bash
for i in $(seq 1 100); do
  curl -X POST http://localhost:3000/api/repos -d '{}' \
    -H content-type:application/json
done
# Затем извлечь build_finished events первого билда каждого нового
# project'а из audit-log (сравнив projectId с created-event'ами).
```

(TODO: дописать `bench-cold-build.ts` когда реально потребуется.)

### End-to-end turn

End-to-end measure'ится через продуктовый сценарий — нет смысла
автоматизировать без LLM stub. На staging — manual test с
секундомером по 8 сценариям из `VERIFICATION.md` §1.

---

## Результаты

> Заполняется по факту. Каждая строчка — один прогон. Никогда не редактируй
> прошлые результаты — добавляй новые с timestamp'ом.

### Warm build

| Дата       | Iter | Concurrency | p50    | p95    | p99    | success | env     | commit  |
|------------|------|-------------|--------|--------|--------|---------|---------|---------|
| _pending_  | _N=100_ | _1_ | _—_    | _—_    | _—_    | _—_     | staging | _—_     |

### Cold build

| Дата       | Iter | p50    | p95    | success | env     | commit  |
|------------|------|--------|--------|---------|---------|---------|
| _pending_  | _N=100_ | _—_ | _—_   | _—_     | staging | _—_     |

### Volume size

| Дата       | `adorable_node_modules_react_<v>` | image size build-runner | env     |
|------------|-----------------------------------|-------------------------|---------|
| _pending_  | _—_                                | _—_                     | staging |

### Memory peak

| Дата       | Cold build peak    | Warm build peak    | env     |
|------------|--------------------|--------------------|---------|
| _pending_  | _—_                | _—_                | staging |

---

## Acceptance gate (для #12 default-switch)

Все следующие должны быть зелёными ОДИН раз на staging перед тем как
поменять `.env.example` `PREVIEW_PROVIDER=sandbox` → `static`:

- [ ] Warm build p50 < 10s, p95 < 20s (за 100 итераций)
- [ ] Cold build p50 < 30s, p95 < 60s (за 100 итераций)
- [ ] Success rate ≥ 95% на 24-часовом soak'е
- [ ] Volume size < 500 MB
- [ ] Memory peak build-runner < 1.5 GB
- [ ] Все 8 продуктовых сценариев из `VERIFICATION.md` §1 pass'ят
      (см. STATIC_MODE_REMAINING.md §9)

---

_Last updated: 2026-04-30 — file created (no benchmarks recorded yet)._
