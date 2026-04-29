# AVAILABLE DEPENDENCIES — boilerplate v1.0.0

This is the COMPLETE list of npm packages available in this project.
Do NOT import packages that are not listed here — the build will fail.

## Runtime dependencies

- class-variance-authority
- clsx
- lucide-react
- react
- react-dom
- react-router-dom
- tailwind-merge

## Build / dev dependencies (typecheck only — not bundled)

- @vitejs/plugin-react
- autoprefixer
- postcss
- tailwindcss
- tailwindcss-animate
- vite

## NOT AVAILABLE — common requests with suggested replacements

- `@chakra-ui/react` → Build UI with Tailwind classes + lucide-react icons instead of Chakra.
- `@emotion/react` → Use Tailwind utility classes instead of @emotion/react.
- `@emotion/styled` → Use Tailwind utility classes instead of @emotion/styled.
- `@mui/material` → Build UI with Tailwind classes + lucide-react icons instead of MUI.
- `@tanstack/query-core` → Import from `@tanstack/react-query`.
- `axios` → Use the built-in `fetch` API instead of axios.
- `dayjs` → Use `date-fns` instead of dayjs.
- `express` → This project is a static SPA — no Express server. Connect to the managed BaaS for backend functionality.
- `fastify` → This project is a static SPA — no Fastify. Connect to the managed BaaS for backend functionality.
- `jquery` → Replace jQuery with React refs (`useRef`) and state (`useState`).
- `lodash-es` → Import from `lodash` (e.g. `import { debounce } from 'lodash'`).
- `luxon` → Use `date-fns` instead of luxon.
- `mongodb` → This project is a static SPA — no DB. Use the managed BaaS for persistent data.
- `mysql` → This project is a static SPA — no DB. Use the managed BaaS for persistent data.
- `mysql2` → This project is a static SPA — no DB. Use the managed BaaS for persistent data.
- `next` → Use Vite + react-router-dom for routing instead of Next.js.
- `pg` → This project is a static SPA — no DB. Use the managed BaaS for persistent data.
- `react-query` → Import from `@tanstack/react-query` (v5).
- `styled-components` → Use Tailwind utility classes instead of styled-components.

## How this file is generated

Generated automatically from `templates/vite-react/package.json`
and `adorable/lib/preview/available-deps.ts` SYNONYMS table by
`adorable/scripts/generate-available-deps.ts`. Re-run after every
boilerplate version bump (BOILERPLATE.md §3).
