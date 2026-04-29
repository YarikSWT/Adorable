// Pure-функции для валидации UI uploads.
// Контракт: docs/preview-provider/CONTRACTS.md §16, ADR-007.
//
// Зависит ТОЛЬКО от node:Buffer / pure JS. Без fs, без сети.
// API роута собирает результаты и пишет файл; валидатор не думает
// про disk.

// ---------------------------------------------------------------------------
// Whitelisted extensions and their accepted MIME types.
// ---------------------------------------------------------------------------

export type UploadMime =
  | "image/jpeg"
  | "image/png"
  | "image/webp"
  | "image/gif"
  | "image/svg+xml"
  | "video/mp4"
  | "video/webm"
  | "font/woff"
  | "font/woff2"
  | "font/ttf";

const EXT_TO_MIME: Record<string, UploadMime> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  svg: "image/svg+xml",
  mp4: "video/mp4",
  webm: "video/webm",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
};

export const ALLOWED_EXTENSIONS: ReadonlyArray<string> = Object.keys(EXT_TO_MIME);

// ---------------------------------------------------------------------------
// Magic-bytes detection
// ---------------------------------------------------------------------------

const startsWith = (
  bytes: Uint8Array,
  prefix: ReadonlyArray<number>,
  offset = 0,
): boolean => {
  if (bytes.length < offset + prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) {
    if (bytes[offset + i] !== prefix[i]) return false;
  }
  return true;
};

const isLikelySvg = (bytes: Uint8Array): boolean => {
  // Strip leading whitespace + BOM
  let i = 0;
  // UTF-8 BOM
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) i = 3;
  while (i < bytes.length && bytes[i] <= 32) i++;
  // Now expect '<'
  if (bytes[i] !== 0x3c) return false;
  // Decode the next ~256 bytes and look for "<svg" or "<?xml ... <svg".
  const head = Buffer.from(bytes.subarray(i, Math.min(i + 512, bytes.length)))
    .toString("utf8")
    .toLowerCase();
  return head.startsWith("<svg") || head.includes("<svg");
};

/**
 * Best-effort magic-bytes detection. Returns the canonical MIME or null.
 * Source: see well-known signatures and ADR-007.
 */
export const detectMimeFromMagic = (
  raw: ArrayBufferView | ArrayBuffer,
): UploadMime | null => {
  const bytes =
    raw instanceof ArrayBuffer
      ? new Uint8Array(raw)
      : new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
  if (bytes.length < 4) return null;

  // JPEG: FF D8 FF
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  ) {
    return "image/png";
  }
  // GIF87a / GIF89a
  if (
    startsWith(bytes, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) ||
    startsWith(bytes, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
  ) {
    return "image/gif";
  }
  // WebP: RIFF....WEBP
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return "image/webp";
  }
  // MP4: <size:4> "ftyp"
  if (startsWith(bytes, [0x66, 0x74, 0x79, 0x70], 4)) return "video/mp4";
  // WebM / Matroska: EBML 1A 45 DF A3
  if (startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])) return "video/webm";
  // WOFF: "wOFF"
  if (startsWith(bytes, [0x77, 0x4f, 0x46, 0x46])) return "font/woff";
  // WOFF2: "wOF2"
  if (startsWith(bytes, [0x77, 0x4f, 0x46, 0x32])) return "font/woff2";
  // TTF: 00 01 00 00 (TrueType) / "true" / "OTTO" (OpenType)
  if (
    startsWith(bytes, [0x00, 0x01, 0x00, 0x00]) ||
    startsWith(bytes, [0x74, 0x72, 0x75, 0x65]) ||
    startsWith(bytes, [0x4f, 0x54, 0x54, 0x4f])
  ) {
    return "font/ttf";
  }
  // SVG: text-based, look for "<svg"
  if (isLikelySvg(bytes)) return "image/svg+xml";
  return null;
};

// ---------------------------------------------------------------------------
// Filename sanitisation
// ---------------------------------------------------------------------------

const TRANSLIT: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "zh",
  з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o",
  п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts",
  ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu",
  я: "ya",
};

const transliterate = (s: string): string => {
  let out = "";
  for (const ch of s.toLowerCase()) {
    out += TRANSLIT[ch] ?? ch;
  }
  return out;
};

/**
 * Sanitise an upload filename per ADR-007 §16.4:
 *   - lowercase
 *   - cyrillic → latin transliteration
 *   - any non-[a-z0-9._-] char → "-"
 *   - collapse repeated "-"
 *   - reject ".." segments and leading "/"
 *   - max length 96 chars (leaves room for path prefix)
 *
 * Returns the sanitised name or null if the input is unsalvageable.
 */
export const sanitiseUploadName = (input: string): string | null => {
  if (typeof input !== "string" || input.length === 0) return null;
  if (input.includes("\0")) return null;
  // Reject ".." anywhere — covers `../etc`, `..\\foo`, `foo..bar`.
  // Path traversal is the threat; we don't try to be clever.
  if (input.includes("..")) return null;
  // Strip leading path components (everything before last / or \).
  // After the .. check, this is purely cosmetic ("subdir/photo.png" →
  // "photo.png"); any traversal attempt has already been rejected.
  const base = input.replace(/^.*[\\/]/, "");
  if (base === "" || base === ".") return null;
  let s = transliterate(base);
  s = s
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
  if (s === "" || s === "." || s === "..") return null;
  if (s.length > 96) {
    // keep extension intact
    const dot = s.lastIndexOf(".");
    if (dot > 0) {
      const ext = s.slice(dot);
      s = s.slice(0, 96 - ext.length) + ext;
    } else {
      s = s.slice(0, 96);
    }
  }
  return s;
};

// ---------------------------------------------------------------------------
// validateUpload
// ---------------------------------------------------------------------------

export type UploadErrorCode =
  | "size-exceeded"
  | "ext-not-allowed"
  | "magic-bytes-mismatch"
  | "invalid-name";

export interface UploadValidationOk {
  ok: true;
  safeName: string;
  mime: UploadMime;
  size: number;
}

export interface UploadValidationErr {
  ok: false;
  error: UploadErrorCode;
  details: string;
}

export type UploadValidationResult = UploadValidationOk | UploadValidationErr;

export interface ValidateUploadOptions {
  filename: string;
  content: ArrayBufferView | ArrayBuffer;
  sizeLimitBytes: number;
}

const sizeOf = (raw: ArrayBufferView | ArrayBuffer): number =>
  raw instanceof ArrayBuffer ? raw.byteLength : raw.byteLength;

export const validateUpload = (
  opts: ValidateUploadOptions,
): UploadValidationResult => {
  const size = sizeOf(opts.content);
  if (size > opts.sizeLimitBytes) {
    return {
      ok: false,
      error: "size-exceeded",
      details: `File size ${size} exceeds limit ${opts.sizeLimitBytes}.`,
    };
  }
  const safeName = sanitiseUploadName(opts.filename);
  if (!safeName) {
    return {
      ok: false,
      error: "invalid-name",
      details: `Filename "${opts.filename}" cannot be sanitised.`,
    };
  }
  const dot = safeName.lastIndexOf(".");
  if (dot < 0 || dot === safeName.length - 1) {
    return {
      ok: false,
      error: "ext-not-allowed",
      details: `Filename "${safeName}" has no extension.`,
    };
  }
  const ext = safeName.slice(dot + 1);
  const expectedMime = EXT_TO_MIME[ext];
  if (!expectedMime) {
    return {
      ok: false,
      error: "ext-not-allowed",
      details: `Extension ".${ext}" is not allowed (whitelist: ${ALLOWED_EXTENSIONS.join(", ")}).`,
    };
  }
  const detectedMime = detectMimeFromMagic(opts.content);
  if (!detectedMime || detectedMime !== expectedMime) {
    return {
      ok: false,
      error: "magic-bytes-mismatch",
      details: `Detected MIME ${detectedMime ?? "<unknown>"} does not match expected ${expectedMime} for extension ".${ext}".`,
    };
  }
  return { ok: true, safeName, mime: expectedMime, size };
};
