# Freestyle Integration Points

Карта всех прямых и косвенных зависимостей от Freestyle SaaS в форке Adorable. Каждая точка помечена зоной миграции и фазой.

## Зоны
- **SBX** — sandbox VMs (Phase 2)
- **GIT** — git repos (Phase 3)
- **DEP** — deploy/serverless (Phase 5)
- **DOM** — domain mapping / preview (Phase 4)
- **IDN** — identity/permissions (Phase 3 / Phase 1.5-auth)

## Точки

| Файл:строка | Зона | API / Описание |
|---|---|---|
| `adorable/package.json:25` | SBX | `@freestyle-sh/with-dev-server` dep |
| `adorable/package.json:26` | SBX | `@freestyle-sh/with-pty` dep |
| `adorable/package.json:27` | SBX | `@freestyle-sh/with-ttyd` dep |
| `adorable/package.json:39` | SBX+GIT+DEP+IDN | `freestyle-sandboxes` dep (monolithic client) |
| `adorable/lib/adorable-vm.ts:1-4` | SBX | Imports VmSpec, VmDevServer, VmPtySession, VmWebTerminal |
| `adorable/lib/adorable-vm.ts:24-44` | SBX | `adorableVmSpec` with dev-server + PTY + web-terminal |
| `adorable/lib/adorable-vm.ts:49` | DOM | Генерит домен `<uuid>-adorable.style.dev` для preview |
| `adorable/lib/adorable-vm.ts:53` | SBX | `freestyle.vms.create({ snapshot, git, domains, persistence })` |
| `adorable/lib/repo-storage.ts:2` | GIT | import freestyle |
| `adorable/lib/repo-storage.ts:63` | GIT | `freestyle.git.repos.ref({ repoId }).branches.getDefaultBranch()` |
| `adorable/lib/repo-storage.ts:72-79` | GIT | `repo.contents.get({ path, rev })` |
| `adorable/lib/repo-storage.ts:89-100` | GIT | `repo.commits.create({ message, branch, files, author })` |
| `adorable/lib/identity-session.ts:2` | IDN | import freestyle |
| `adorable/lib/identity-session.ts:10-15` | IDN | `freestyle.identities.ref(...).permissions.git.list(...)` |
| `adorable/lib/identity-session.ts:29` | IDN | `freestyle.identities.create({})` |
| `adorable/lib/create-tools.ts:2` | SBX+DEP | import freestyle, Vm |
| `adorable/lib/create-tools.ts:334` | DEP | литерал "adorable@freestyle.sh" (committer email) |
| `adorable/lib/create-tools.ts:361-366` | DEP | `freestyle.serverless.deployments.create({ repo, domains, build })` |
| `adorable/lib/deployment-status.ts:1` | DEP+GIT | import freestyle |
| `adorable/lib/deployment-status.ts:29-30` | GIT | `freestyle.git.repos.ref(...).commits.list({ limit, order })` |
| `adorable/lib/deployment-status.ts:61-63` | DEP | `freestyle.serverless.deployments.list({ limit })` |
| `adorable/lib/deployment-status.ts:101-102` | GIT | `repo.commits.list(...)` повтор |
| `adorable/lib/deployment-status.ts:106-108` | DEP | `freestyle.serverless.deployments.list(...)` повтор |
| `adorable/lib/vars.ts:2` | GIT | `TEMPLATE_REPO = "http://github.com/freestyle-sh/freestyle-base-nextjs-shadcn"` — это просто public GitHub URL, НЕ Freestyle API. Можно оставить или проксировать через свой template. |
| `adorable/app/api/repos/route.ts:3` | - | import freestyle |
| `adorable/app/api/repos/route.ts:95-97` | DEP | `freestyle.serverless.deployments.list({ limit: 500 })` |
| `adorable/app/api/repos/route.ts:142-143` | GIT | `freestyle.git.repos.create({ name })` + `.githubSync.enable(...)` |
| `adorable/app/api/repos/route.ts:151-158` | GIT | `freestyle.git.repos.create({ name, import: { url, type: "git" } })` — клонирует template |
| `adorable/app/api/repos/route.ts:165` | GIT | `freestyle.git.repos.create({ name })` для wrapper-репо |
| `adorable/app/api/repos/route.ts:170-178` | IDN | `identity.permissions.git.grant({ permission, repoId })` |
| `adorable/app/api/repos/route.ts:182-184` | IDN | `identity.permissions.vms.grant({ vmId })` |
| `adorable/app/api/repos/[repoId]/promote/route.ts:2` | DOM | import freestyle |
| `adorable/app/api/repos/[repoId]/promote/route.ts:11` | IDN | `identity.permissions.git.list` |
| `adorable/app/api/repos/[repoId]/promote/route.ts:55-58` | DOM | `freestyle.domains.mappings.create({ domain, deploymentId })` |
| `adorable/app/api/chat/route.ts:3` | - | import freestyle |
| `adorable/app/api/chat/route.ts:38` | IDN | `identity.permissions.git.list({ limit: 200 })` |
| `adorable/app/api/chat/route.ts:55-58` | SBX | `freestyle.vms.ref({ vmId, spec })` |
| `adorable/README.md:52` | - | Documentation: "Create a GitHub App through the Freestyle Dashboard" |
| `adorable/components/assistant-ui/home-welcome.tsx:240` | - | Link to `https://dash.freestyle.sh/` (UI copy) |

## Сводка API surface area (то что нужно реплицировать в адаптерах)

### `freestyle.vms`
- `.create({ snapshot, recreate, workdir, persistence, git, domains })` → `{ vmId }`
- `.ref({ vmId, spec })` → VM ref с:
  - `.exec({ command })` → string | `{ stdout, stderr, exitCode, ok }`
  - `.fs.readFile(path)`, `.fs.readTextFile(path)`, `.fs.writeTextFile(path, content)`
  - `.devServer.getLogs()` → string | string[]

### `freestyle.git.repos`
- `.create({ name?, import?: { url, type: "git", commitMessage } })` → `{ repo, repoId }`
- `.ref({ repoId })` → repo ref с:
  - `.branches.getDefaultBranch()` → `{ defaultBranch }`
  - `.contents.get({ path, rev })` → `{ type, content (base64) }`
  - `.commits.create({ message, branch, files, author })` → void
  - `.commits.list({ limit, order })` → `{ commits: [{ sha, message, author: { date } }] }`
  - `.githubSync.enable({ githubRepoName })` — заменимо через Gitea + push-mirror

### `freestyle.identities`
- `.create({})` → `{ identityId, identity }`
- `.ref({ identityId })` → identity ref с:
  - `.permissions.git.list({ limit })` → `{ repositories: [{ id, name }] }`
  - `.permissions.git.grant({ permission, repoId })`
  - `.permissions.vms.grant({ vmId })`

### `freestyle.serverless.deployments`
- `.create({ repo, domains, build })` → `{ id, ...}`
- `.list({ limit })` → `{ entries: [{ deploymentId, state, domains }] }`

### `freestyle.domains.mappings`
- `.create({ domain, deploymentId })` → void

## Картирование: что заменяет что

| Freestyle API | Замена |
|---|---|
| `freestyle.vms.*` | `SandboxProvider` (lib/adapters/sandbox.ts) — docker impl |
| `freestyle.git.repos.*` | `GitProvider` (lib/adapters/git.ts) — gitea impl |
| `freestyle.identities.*` | Better Auth (users) + app DB table `user_repo_permissions` + Gitea org-per-user |
| `freestyle.serverless.deployments.*` | `DeployProvider` (lib/adapters/deploy.ts) — kamal impl |
| `freestyle.domains.mappings.*` | `ProxyProvider.addRoute(domain, target)` — caddy impl |
| `VmDevServer`, `VmPtySession`, `VmWebTerminal` | embedded dev server в sandbox image + ttyd sidecar; proxy-роут на порт контейнера |
