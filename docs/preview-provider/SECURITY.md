# SECURITY.md — модель угроз

Документ описывает поверхность атаки для миграции на static-режим
PreviewProvider'а. Сравнивается со sandbox-режимом (текущий
`SECURITY.md` в корне репо). Цель — явно зафиксировать что становится
проще, что появляется нового, какими механизмами защищаемся.

Source: ADR-005 (build-runner isolation), ADR-006 (scratch dir),
ADR-007 (UI uploads), ADR-009 (static-only), ADR-019 (deps lockdown).

---

## 1. Trust boundaries

```
┌─────────────────────────────────────────────────────────────┐
│                       UNTRUSTED                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ End-user browser (UI iframe + chat)                  │    │
│  │ — отправляет prompt'ы → LLM генерирует код          │    │
│  │ — загружает бинарные ассеты через POST /upload      │    │
│  │ — открывает рендер preview через Caddy               │    │
│  └─────────────────────────────────────────────────────┘    │
│                            ↕                                  │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ LLM (внешний API)                                    │    │
│  │ — генерирует **untrusted** код в JSX/TS              │    │
│  │ — вызывает tools (readFile, writeFile, ...)          │    │
│  │ — может галлюцинировать злонамеренные импорты        │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                              ↕  HTTP/SSE
┌─────────────────────────────────────────────────────────────┐
│                        TRUSTED                               │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ Builder (Next.js process)                            │    │
│  │ — pre-validates LLM tool calls (whitelist путей)     │    │
│  │ — owns scratch + static dirs                         │    │
│  │ — запускает build-runner через docker socket         │    │
│  │ — owns Gitea credentials                             │    │
│  └─────────────────────────────────────────────────────┘    │
│                            ↓                                 │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ Build-runner (ephemeral Docker container)            │    │
│  │ — запускает `vite build` на UNTRUSTED исходниках     │    │
│  │ — RO node_modules, RO src/, RO public/, RW dist/     │    │
│  │ — read-only rootfs, --user=1000, capDrop=ALL,       │    │
│  │   no-new-privileges, isolated network               │    │
│  └─────────────────────────────────────────────────────┘    │
│                            ↓                                 │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ Caddy (file_server) → /data/static/<id>/current/     │    │
│  │ — раздаёт статику; не исполняет код                 │    │
│  │ — отдельная сеть, минимум privileges                │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

**Ключевая модель**: всё что генерирует или загружает пользователь —
**untrusted**. Builder между UI и build-runner'ом валидирует и
санитизирует. Build-runner запускает untrusted code в максимально
ограниченной среде. Caddy раздаёт статику, никакого SSR.

---

## 2. Что становится проще vs sandbox-режим

| Угроза в sandbox-only          | Состояние в static                                  |
|--------------------------------|-----------------------------------------------------|
| Container escape через runtime | **Не применимо** — нет долгоживущего контейнера     |
| Сетевые атаки изнутри sandbox  | **Снижено** — build-runner в isolated сети без интернета |
| Process exhaustion (fork bomb) | **Снижено** — `--pids-limit=512`, ephemeral lifecycle (max 2 мин) |
| Memory leaks в long-running    | **Не применимо** — каждый билд новый контейнер       |
| Kernel exploits via lots of syscalls | **Снижено** — короткое время выполнения, capDrop ALL |
| Persistence через volume       | **Снижено** — workspace bind-mounts, нет writable rootfs |
| Custom npm-зависимости с RCE   | **Устранено** — RO named volume, фиксированный список (ADR-019) |
| `npm install` exploits         | **Устранено** — install не происходит во время билда |
| Reverse shell наружу           | **Снижено** — изолированная сеть `adorable_build` без upstream |
| Crypto miners в long-process   | **Устранено** — 2-мин hard timeout, ephemeral exit  |

**Главная защита static**: пользователь не управляет зависимостями.
Это устраняет целый класс supply-chain угроз.

---

## 3. Поверхность атаки в static-режиме

### 3.1. LLM-сгенерированный код в `src/**/*.jsx`

**Угроза**: LLM может сгенерировать код, который:
- импортирует пакет вне AVAILABLE_DEPS → билд упадёт (ADR-018) →
  парсер вернёт `import-not-allowed` → не попадёт в bundle.
- содержит `<script>` injection через innerHTML / dangerouslySetInnerHTML
  → попадёт в bundle и выполнится в браузере конечного пользователя
  preview.
- содержит логику для exfiltration данных (например fetch на
  внешний C2 сервер) → попадёт в bundle, выполнится в браузере.

**Митигация**:
- Imports validation **есть** (через build pipeline + AVAILABLE_DEPS).
- Inline scripts / XSS — **не валидируется** на нашей стороне.
  Это **acceptable риск** для MVP, потому что:
  - Preview раздаётся на subdomain'е `<id>.preview.<base>`, изолирован
    cookie-доменами от основного приложения.
  - Конечный пользователь preview — это **тот же** пользователь,
    который поручил LLM сгенерировать код. Self-XSS.
  - Если конечный пользователь делится preview-URL'ом с другими —
    риск падает на share'щика. В UI добавить warning «вы делитесь
    untrusted кодом».
- В `LIMITATIONS.md` зафиксировать: «preview = untrusted code,
  не делитесь URL'ами с третьими лицами без review».

### 3.2. LLM-сгенерированный код в `functions/**/*.ts`

**Угроза**: LLM пишет TypeScript edge-функцию с злонамеренным кодом
(exfiltration credentials из Deno.env, абуз внешних API).

**Митигация на MVP**:
- Functions **не исполняются** на MVP (ADR-021). Файлы только хранятся.
- При появлении BaaS-runtime — отдельный security review (open question).

### 3.3. Build-runner escape

**Угроза**: `vite build` или его плагин содержит RCE; атакующий
эксплуатирует через специально сконструированный `src/`-файл.

**Митигация (defense-in-depth)**:
- `--read-only` rootfs — нельзя писать в `/etc`, `/usr`, etc.
- `tmpfs /tmp:size=200m` — единственное writable место кроме mounts.
- `--user=1000:1000` — без root.
- `--cap-drop=ALL` — все capabilities drop'нуты.
- `--security-opt=no-new-privileges:true` — `setuid`/`setgid` блокирован.
- `--network=adorable_build` — internal-only сеть, нет upstream
  connectivity. Без интернета `npm install` не сработает (он и не
  нужен — `node_modules` уже в RO volume).
- `--pids-limit=512`, `--memory=2g`, `--cpus=2` — лимиты.
- `--rm` — контейнер удаляется при exit, нет persistence.
- Hard timeout `BUILD_RUNNER_TIMEOUT_MS` — 2 мин, после SIGKILL.
- `node_modules` mounted **read-only** — нельзя пожечь общий volume.

Если RCE всё-таки случится: атакующий внутри контейнера видит
- `/workspace/src/**` — но это его же файлы.
- `/workspace/dist/**` — может писать, но разрушит только свой билд
  (артефакт перезапишется следующим успешным билдом).
- `/workspace/.vite/**` — может коррапт build cache одного проекта.
- `/workspace/node_modules/**` — RO, не пожжёт shared.
- Сети наружу нет → нельзя exfiltrate.
- Persistence через rootfs нет → нельзя установить tooling.

**Compromise window**: один билд = один контейнер = max 2 мин.

### 3.4. UI uploads — multipart abuse

**Угроза**: атакующий шлёт через `POST /api/projects/:id/upload`
- Файл с расширением `.jpg`, но magic-bytes как у `.exe` →
  загрузится и потом скачается жертвой как «фото».
- Файл размером 100 GB → DoS на диске.
- Имя `../../../etc/passwd` → traversal.
- Файл с executable contents (PHP, JS) → если Caddy раздаст с
  Content-Type:text/html → XSS.

**Митигация (ADR-007)**:
- `UPLOAD_MAX_BYTES = 5 * 1024 * 1024` — реджект больших.
- Whitelist расширений (`.jpg`, `.png`, ..., `.svg`, `.mp4`, ..., `.woff`).
- **Magic-bytes валидация** через `file-type` библиотеку. Mismatch → 400.
- Санитизация имени: lower-case, не-ASCII → транслит, спецсимволы →
  `-`, запрет `..`, `\0`, ведущих `/`.
- Caddy раздаёт `/data/static/<id>/current/` — пользовательских
  uploads там нет (uploads → `/data/projects/<id>/public/`, копируются
  в `dist/public/` через `vite build` без интерпретации). Vite
  публикует только whitelisted-extension файлы.
- SVG **может** содержать `<script>` — XSS. Полный sanitize SVG
  через DOMPurify-server-side — открытый вопрос. На MVP считаем
  acceptable (тот же self-XSS scope).
- ClamAV для антивируса — open question, magic-bytes baseline.

**Что не митигируем явно**:
- Содержимое legitimate-форматов (`.png` с steganography данными).
  Acceptable: пользователь уже trusted к собственному проекту.

### 3.5. Scratch dir traversal

**Угроза**: LLM через `writeFileTool('../../../../../etc/passwd', ...)`
пытается записать вне scratch dir.

**Митигация (CONTRACTS.md `isWritablePath`)**:
- Pure-функция отклоняет любой `..`, `\0`, ведущий `/`.
- Pre-whitelist regex `^(src|public|functions)/` — даже без
  traversal'а нельзя писать в корень `/data/projects/<id>/`.
- Дополнительно node `path.resolve(scratchDir, relPath)` и проверка
  что результат начинается с scratchDir — defense-in-depth.

### 3.6. Named volume poisoning

**Угроза**: атакующий получает write-доступ к
`adorable_node_modules_react_<v>` volume → инжектит malicious код
в shared `node_modules` → следующий билд **любого** проекта запускает
это.

**Митигация**:
- Volume mounted **`:ro`** во все build-runner'ы (ADR-005).
  Никто из контейнеров не может писать в него.
- Заполнение volume — **только** init-контейнером при сборке image
  (через `cp -a`). Запускается platform-engineer'ом, не на каждый
  билд.
- Build-runner **не имеет docker socket** — не может управлять
  volume'ами.
- Builder process имеет docker socket, но не делает write в volume —
  только read через mount option `:ro` для контейнеров.

**Compromise**: если platform-engineer заинжектит malicious deps в
volume — это уже сама platform-team. Это про trusted platform-team,
не про user-side attack.

### 3.7. Build-cache poisoning

**Угроза**: атакующий через RCE в build-runner'е (см. §3.3) пишет
malicious cache в `/data/projects/<id>/.vite/` → следующий билд того
же проекта подхватывает.

**Митигация**:
- Build-cache **per-project** (ADR-016) — нельзя отравить чужой
  проект.
- Vite сам инвалидирует cache на изменение `vite.config.js` (фикс) и
  `package.json` (фикс) — невалидный entry просто пересоберётся.
- Атакующий уже имеет write-доступ в `src/**` (он же LLM/user) —
  cache poisoning не повышает privilege.

Не митигируем: cache poisoning — known-acceptable риск в pipeline,
поскольку атакующий уже владеет источником.

### 3.8. Docker socket exposure

**Угроза**: builder имеет `/var/run/docker.sock` mounted (для
dockerode). RCE в builder'е → control plane доступ ко всем
контейнерам и volume'ам.

**Митигация**:
- Builder сам по себе trusted process — RCE здесь = full system
  compromise (independent of static vs sandbox).
- В prod рекомендуется выносить docker daemon на отдельный host через
  TCP+TLS (см. комментарий в `docker-compose.prod.yml`). На MVP —
  acceptable, тот же что и для sandbox-режима.
- В static-режиме builder вызывает только узкий API: `createContainer`
  + `start` + `wait` + `kill` для ephemeral build-runner'ов. Аудит
  всех вызовов через audit-log.

### 3.9. SSE-stream abuse

**Угроза**: атакующий держит долгие SSE-соединения на
`/api/projects/:id/build-status`, исчерпывает file descriptor'ы
builder'а.

**Митигация**:
- В builder'е лимит `ulimit -n` — стандартный.
- Per-project одновременных подписчиков — нужна метрика (open
  question: лимит).
- Аутентификация SSE: нужен `repoMetadata.access` check на каждое
  подключение (existing `identity-session.ts` ACL).

### 3.10. Resource exhaustion на уровне очереди

**Угроза**: атакующий завершает много turn'ов LLM подряд (или жмёт
Rebuild) → BuildQueue копит много контейнеров.

**Митигация (ADR-012)**:
- `max 1 running + 1 queued` per project — старый queued cancel'ится.
  Очередь не растёт.
- UI debounce ~500мс на Rebuild.
- Cross-project — открытый вопрос: один пользователь с N проектами
  может занять N build-runner'ов одновременно. Лимит concurrent
  build'ов через global `BUILD_RUNNER_GLOBAL_CONCURRENCY` (open
  question, default unbounded на MVP single-instance).

### 3.11. Gitea ACL bypass

**Угроза**: атакующий получает доступ к проекту, на который у него
нет permission.

**Митигация (унаследована из sandbox-режима)**:
- `lib/identity-session.ts` ACL — uuid в httpOnly cookie + in-memory
  Map. На prod — Better Auth (отдельная задача).
- Gitea-токен, который видит только builder, никогда не попадает в
  user-land (ни в sandbox, ни в build-runner).

### 3.12. Static URL prediction

**Угроза**: атакующий угадывает чужой `<projectId>.preview.<base>`
URL → видит чужой preview.

**Митигация**:
- `projectId` = uuid (~122 bit entropy). Prediction infeasible.
- Но URL шарабельный по дизайну (пользователь хочет показать другу).
  Это feature.
- Если нужна privacy — добавить аутентификацию на Caddy уровне для
  preview URLs (нужно сообщать сессию через cookies). На MVP —
  публичный шарабельный preview, как у base44/v0/Lovable.

---

## 4. Что не митигируем явно (явные acceptable risks)

| Риск                                  | Обоснование                                 |
|---------------------------------------|---------------------------------------------|
| Self-XSS в собственном preview        | Тот же пользователь, scoped subdomain      |
| SVG `<script>` в UI uploads           | Self-XSS scope; sanitize — open question    |
| Build-cache poisoning self-project    | Атакующий уже владеет источником            |
| Steganography in legit image formats  | Out-of-scope для билдер'а                  |
| Crypto-miner в собранном bundle       | Self-DoS — пострадает посетитель preview, который сам же его и собрал |
| Distributed coordination via SSE      | Требует SSE, которая узко-aut'ная (см. §3.9) |

---

## 5. UI / Backend / Platform-team responsibilities

| Слой         | Ответственность                                                  |
|--------------|------------------------------------------------------------------|
| `[UI]`       | warning «не делитесь preview-URL'ами без review»; debounce кнопок; capability-driven render |
| `[Backend]`  | `isWritablePath` валидация; magic-bytes для uploads; `mv -T` atomic swaps; ACL на SSE; запуск build-runner'а с правильными flags |
| `[Platform]` | Pinned versions of build-runner image; init-volume safe-копирование; secret rotation; docker daemon hardening |

---

## 6. Audit log — что обязательно записываем

Через существующий `lib/sandbox/audit-log.ts`. Минимальный набор
security-relevant events:

| Event                          | Поля                                            |
|--------------------------------|-------------------------------------------------|
| `auth-allow` / `auth-deny`     | userId, projectId, action, reason               |
| `path-rejected`                | userId, projectId, path, reason                 |
| `upload-rejected`              | userId, projectId, name, size, reason           |
| `build-started`                | jobId, projectId, boilerplateVersion, userId    |
| `build-finished`               | jobId, status, exitCode, durationMs, errors     |
| `build-cancelled`              | jobId, reason                                   |
| `build-runner-killed-timeout`  | jobId, durationMs, signal                       |
| `proxy-route-added/removed`    | id, hostname, target.type                       |
| `boilerplate-migration`        | fromVersion, toVersion, projectIds, results     |

Audit log пишется в JSON-lines, ротируется наружу
(`SANDBOX_AUDIT_LOG` env, переименуется в `ADORABLE_AUDIT_LOG` —
open question, не блокер).

---

## 7. Threat model для будущей BaaS-интеграции (out of MVP)

Когда `functions/**/*.ts` начнут исполняться — открывается новый
attack surface:
- Outbound сеть из functions → exfiltration рискует.
- Secret management для `Deno.env.get(...)` — где они хранятся, кто
  читает.
- Cold-start security (поднимаем Deno-isolate на запрос).
- Multi-tenant isolation в shared BaaS-runtime.

Это **отдельная** security-сессия, после выбора BaaS-провайдера.
В этом документе только flag'аем. См. `OPEN_QUESTIONS.md`.

---

## 8. Compliance / regulatory (RU-context)

Платформа размещается в RU. Применимые нормы (на момент написания):
- ФЗ-152 «О персональных данных» — если пользователь хранит ПДн
  в проекте (например, в localStorage генерируемого приложения).
  На MVP **нет** хранилища ПДн на нашей стороне (статические артефакты
  не содержат ПДн пользователя по дизайну, кроме того что
  пользователь сам туда положил через UI — тогда ответственность на
  нём).
- ОРКД (об оперативно-розыскной деятельности) — не применимо к
  статическим артефактам.
- При появлении BaaS-runtime — пересмотр (хранение пользовательских
  данных уже у нас).

Подробный compliance review — отдельный документ при подходе к
production-launch'у.

---

## 9. Что унаследовано из существующего `SECURITY.md`

Корневой `SECURITY.md` (root репо) описывает sandbox-only модель:
15 ограничений Docker, изоляция сетей, audit-log. Эти меры остаются
в силе для **sandbox-режима** как fallback. Static-режим **подмножество**
этих мер (минус всё что про long-running runtime).

Никаких regression'ов: переход на static = строго более жёсткая
модель безопасности для типичного use-case'а.

---

_Last updated: 2026-04-28._
