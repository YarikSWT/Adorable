/**
 * Раньше здесь лежал URL внешнего GitHub-template (Next.js + shadcn).
 * Сейчас дефолтный template — Vite + React, он бандлится в
 * `adorable/templates/vite-react/` и заливается в новый репо через
 * `lib/template-seeder.ts`. Оставляем константу пустой для обратной
 * совместимости, чтобы импорты не рухнули; код, который её читал
 * (repos/route.ts), переключён на seedTemplateRepo.
 */
export const TEMPLATE_REPO = "";
export const WORKDIR = "/workspace";
/** Порт dev-сервера внутри sandbox. Vite default — 5173. */
export const VM_PORT = 5173;
export const MODEL = "gpt-5-mini";
export const DEV_COMMAND_TERMINAL_PORT = 3010;
export const ADDITIONAL_TERMINALS_PORT = 3020;
