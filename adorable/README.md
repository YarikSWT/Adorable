This is an [assistant-ui](https://github.com/Yonom/assistant-ui) project with provider-agnostic backend routing and repo-backed conversation persistence.

## Getting Started

### 1. Configure Environment Variables

Create a `.env.local` file in the root directory and add your credentials:

```
# Default provider: OpenAI
LLM_PROVIDER=openai
OPENAI_API_KEY=your-openai-api-key

# Optional: Claude provider support (swap provider without touching UI code)
# LLM_PROVIDER=claude
# ANTHROPIC_API_KEY=your-anthropic-api-key
```

> **Note**: You can copy `.env.example` to `.env.local` and fill in your values.

### 2. Install Dependencies

```bash
npm install
# or
yarn install
# or
pnpm install
# or
bun install
```

### 3. Run the Development Server

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

### 4. (Optional) Set Up GitHub Sync

To enable creating projects from existing GitHub repositories:

1. Follow the [GitHub App Setup Guide](../GITHUB_APP_SETUP.md)
2. Create a GitHub App through the [Freestyle Dashboard](https://dash.freestyle.sh/)
3. Install the GitHub App on your GitHub repositories
4. Use the "From GitHub" option when creating new projects

See [GITHUB_APP_SETUP.md](../GITHUB_APP_SETUP.md) for detailed instructions.

## Development

You can start customizing the UI by modifying components in the `components/assistant-ui/` directory.

### Key Files

- `app/assistant.tsx` - Renders the chat interface and sets up the assistant runtime
- `app/api/chat/route.ts` - Chat API endpoint
- `lib/llm-provider.ts` - Provider wrapper (OpenAI + Claude)
- `components/assistant-ui/thread.tsx` - Chat thread component
- `components/app-sidebar.tsx` - Sidebar with thread list

## Preview Provider migration (Phase 5)

Existing repos created before the preview-provider migration don't carry
`boilerplateVersion` or the `preview` block in their `metadata.json`.
Two scripts backfill that state. Both are idempotent and safe to re-run.

Spec: `docs/preview-provider/MIGRATION_PATH.md` §5.

### 1. Bulk backfill of metadata fields

Walks every wrapper repo in Gitea, fills missing
`boilerplateVersion` (default from `templates/vite-react/VERSION`)
and a `preview` block snapshotting the **active** preview provider's
name + capabilities at migration time. Never overwrites an existing
`preview.provider`.

```bash
# preview which repos would change
npx tsx scripts/migrate-repo-metadata.ts --dry-run

# apply (default scope: all wrapper repos)
npx tsx scripts/migrate-repo-metadata.ts

# stage by batches when you have many repos
npx tsx scripts/migrate-repo-metadata.ts --limit 50
```

The script exits with code 1 if any per-repo write errored — re-run
to retry just those.

### 2. Per-project switch sandbox → static

Manual, one repo at a time. Destroys the project's sandbox container
(best-effort), allocates a static preview environment, and updates
`metadata.preview.provider` to `"static"` with STATIC capabilities
pinned. Doesn't trigger an initial build — that fires automatically
on the next chat turn or via `POST /api/projects/:id/rebuild`.

```bash
# preview the change without writing
npx tsx scripts/migrate-repo-to-static.ts <wrapper-repo-id> --dry-run

# apply
npx tsx scripts/migrate-repo-to-static.ts <wrapper-repo-id>
```

A repo already on `provider: "static"` is a no-op. The static preview
provider is forced regardless of the global `PREVIEW_PROVIDER` env so
the script works correctly while production default stays `sandbox`.

### 3. Emergency rollback flag

`PREVIEW_PROVIDER_FORCE_SANDBOX=1` overrides the env-resolved
provider for *newly-created* projects only. Existing projects keep
their pinned `metadata.preview.capabilities` (ADR-015), so a flipping
this flag does not migrate them retroactively — it just stops the
bleeding while you fix the static pipeline.

Use case: build-runner image broken in production → set the flag,
restart builder, all NEW projects route to sandbox while you debug.
Per-project recovery (after fix) is via `migrate-repo-to-static.ts`.

Spec: `docs/preview-provider/MIGRATION_PATH.md` §6.

## Local dev in static mode

Static mode runs `vite build` inside an ephemeral `build-runner-react`
container, then serves the resulting `dist/` from `adorable-caddy`'s
`file_server`. The first time you stand up the stack you need to seed
two pieces of infra: the build-runner image and its node_modules
named volume.

### Required env

```bash
PREVIEW_PROVIDER=static                       # default for new repos
PROJECTS_ROOT=/data/projects                  # writable scratch dirs
STATIC_ROOT=/data/static                      # built artifacts (host path)
CADDY_STATIC_ROOT=/data/static                # path Caddy sees (ADR-031)
BUILD_RUNNER_NETWORK=adorable_build           # isolated docker network
BUILD_WAIT_DEADLINE_BUFFER_MS=5000            # extra grace on container.wait
```

`PROJECTS_ROOT` and `STATIC_ROOT` must be writable by the Node process
running adorable. `CADDY_STATIC_ROOT` is the *container-internal* path
the `adorable-caddy` service sees for the same content; in
single-node dev where Caddy and Node share an FS, leave both equal.

### Build the build-runner image

The image is `build-runner-react:<boilerplateVersion>`. Version is
read from `templates/vite-react/VERSION` (currently `1.0.0`).

```bash
# From the adorable/ working dir:
docker build \
  -t build-runner-react:1.0.0 \
  -f ../docker/build-runner-react/Dockerfile \
  .
```

Build-context = `adorable/` (the Dockerfile copies from
`templates/vite-react/...` and `scripts/build-runner/init-volume.sh`).

### Seed the node_modules named volume

Build-runner mounts `adorable_node_modules_react_<version>` RO at
`/workspace/node_modules`. The volume must be filled once per version:

```bash
docker volume create adorable_node_modules_react_1.0.0

docker run --rm -u 0:0 \
  -v adorable_node_modules_react_1.0.0:/mnt/dest \
  --entrypoint sh \
  build-runner-react:1.0.0 \
  /workspace/init-volume.sh
```

`-u 0:0` is required: docker creates `/mnt/dest` root-owned, so the
copy needs root. `init-volume.sh` chowns the destination to
`1000:1000` after the copy so the runtime container (which runs as
non-root) can read it (ADR-005).

### Bind STATIC_ROOT into adorable-caddy

For `file_server` routes to resolve, `adorable-caddy` must be able to
see the same files under `CADDY_STATIC_ROOT`. In docker-compose:

```yaml
services:
  adorable-caddy:
    volumes:
      - ${STATIC_ROOT}:${CADDY_STATIC_ROOT}:ro
```

### Verify

After the stack is up:

```bash
# Create a project + first build
curl -X POST http://localhost:3000/api/repos -d '{"name":"test"}' \
  -H content-type:application/json

# Trigger a rebuild
curl -X POST http://localhost:3000/api/projects/<projectId>/rebuild

# Open the preview (subdomain is sha256(repoId).slice(0,8) — ADR-028)
open "http://<hash>.preview.localhost:8080"
```

If `init-volume.sh` errors with "must run as root" — you forgot
`-u 0:0`. If preview returns 404 — `STATIC_ROOT` isn't bound into
adorable-caddy. If build hangs at "container.wait()" — bump
`BUILD_WAIT_DEADLINE_BUFFER_MS`.
