# Security Blockers

Если хоть один security-тест sandbox/proxy упал — фиксируем здесь. Phase 2 / Phase 4 не закрываются с открытыми security-блокерами.

Формат:
```
## <ISO дата> — <заголовок>
- Фаза: <2 | 4>
- Тест: <tests/...>
- Симптом: <что именно нарушено>
- Следующий шаг: <план>
```

---

## 2026-04-22 — Phase 2 sandbox security: все 9 тестов зелёные

- Фаза: 2
- Тесты: `tests/sandbox-security.test.ts`
- Статус: ✅ 9/9 PASS на реальном Docker (см. iteration 7 run).
- Команда проверки:
  ```
  sg docker -c "RUN_DOCKER_TESTS=1 SANDBOX_NETWORK_NAME=adorable_sandboxes \
    SANDBOX_IMAGE=node:22-slim npx vitest run --root adorable \
    tests/sandbox-security.test.ts --testTimeout 180000"
  ```
- Изменения, потребовавшиеся для зелёного статуса:
  - Workspace переведён с named volume на tmpfs (uid/gid в mount options) —
    named volumes ломали запись из-за root:root ownership inside container,
    несмотря на helper-бутстрап. Tmpfs даёт ту же изоляцию + мгновенную
    готовность к записи.
  - Fork-bomb test: отказ от `ps` (нет в slim image), проверяем по
    kernel-сообщению `Cannot fork` + explicit FORKFAIL из loop.

Блокеров на данный момент нет.
