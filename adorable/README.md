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
