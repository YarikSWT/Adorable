// ProjectFs — узкий fs-API над scratch dir статика-проекта (либо
// adapter'ом над sandbox'ом). Этот модуль владеет двумя вещами:
//
//  1. Whitelist для writeFileTool — какие пути LLM может писать.
//     Это pure-функция isWritablePath + сопровождающий объяснитель.
//     Source: docs/preview-provider/CONTRACTS.md §9, ADR-007.
//
//  2. createNodeFsProjectFs(rootDir) — реализация ProjectFs поверх
//     node:fs. Lands в следующей итерации (Phase 2).
//
// Whitelist намеренно строгий и pure: тесты проверяют каждое правило.

// ---------------------------------------------------------------------------
// §9. isWritablePath / explainNonWritable
// ---------------------------------------------------------------------------

/**
 * Pure-проверка: может ли LLM писать в этот относительный путь.
 *
 * Правила (см. CONTRACTS.md §9, ADR-007, ADR-024):
 *   - Только src/**, public/**, functions/** разрешены как корни.
 *   - Path traversal ".." и NUL-байты — запрещены.
 *   - Абсолютные пути запрещены.
 *   - В src/** — JS/TS/CSS/HTML/JSON/SCSS.
 *   - В public/** — текстовые ресурсы (svg/json/xml/txt/html/webmanifest).
 *     Бинарные ассеты (jpg/png/woff/...) загружаются юзером через UI.
 *   - В functions/** — TypeScript edge-handler'ы (.ts) и .json. Файл
 *     functions/tsconfig.json фиксирован — его LLM не пишет.
 */
export const isWritablePath = (relPath: string): boolean => {
  if (typeof relPath !== "string" || relPath.length === 0) return false;
  if (relPath.startsWith("/")) return false;
  if (relPath.includes("\0")) return false;
  // ".." как сегмент пути (даже если внутри длинного имени типа "..foo" — нет,
  // это валидное имя файла; запрещаем только когда ".." стоит как сегмент):
  for (const segment of relPath.split("/")) {
    if (segment === ".." || segment === ".") return false;
  }
  if (!/^(src|public|functions)\//.test(relPath)) return false;

  // src/** — JS/TS-расширения + стили / шаблоны / json:
  if (/^src\/.+\.(js|jsx|ts|tsx|css|scss|html|json)$/.test(relPath)) {
    return true;
  }
  // public/** — только текстовые ресурсы:
  if (/^public\/.+\.(svg|json|xml|txt|html|webmanifest)$/.test(relPath)) {
    return true;
  }
  // functions/** — .ts edge-handlers, .json конфиги; tsconfig.json
  // фиксирован.
  if (
    /^functions\/.+\.(ts|json)$/.test(relPath) &&
    relPath !== "functions/tsconfig.json"
  ) {
    return true;
  }
  return false;
};

/**
 * Хелпер для генерации сообщения ошибки с подсказкой пользователя.
 * Используется ProjectFs.writeTextFile при отклонении (CONTRACTS §9).
 */
export const explainNonWritable = (relPath: string): string => {
  if (typeof relPath !== "string" || relPath.length === 0) {
    return `Path is empty.`;
  }
  if (relPath.startsWith("/")) {
    return `Path "${relPath}" is absolute. Use a path relative to the project root.`;
  }
  if (relPath.includes("\0")) {
    return `Path "${relPath}" contains a NUL byte.`;
  }
  for (const segment of relPath.split("/")) {
    if (segment === "..") {
      return `Path "${relPath}" contains ".." (directory traversal is not allowed).`;
    }
  }
  if (!/^(src|public|functions)\//.test(relPath)) {
    return `Path "${relPath}" is outside writable directories. Only src/**, public/**, and functions/** are writable.`;
  }
  if (
    /\.(jpg|jpeg|png|webp|gif|mp4|webm|woff|woff2|ttf|otf|eot)$/.test(relPath)
  ) {
    return `Path "${relPath}" is a binary asset. Binary files must be uploaded by the user via the UI.`;
  }
  if (relPath === "functions/tsconfig.json") {
    return `Path "${relPath}" is a fixed boilerplate file and cannot be edited.`;
  }
  return `Path "${relPath}" is not writable in this project.`;
};
