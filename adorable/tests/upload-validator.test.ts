// Тесты pure-валидатора uploads (CONTRACTS §16, ADR-007).

import { describe, expect, it } from "vitest";

import {
  detectMimeFromMagic,
  sanitiseUploadName,
  validateUpload,
  ALLOWED_EXTENSIONS,
} from "@/lib/preview/upload-validator";

const bytes = (...arr: number[]): Uint8Array => new Uint8Array(arr);

const PNG_HEADER = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0);
const JPEG_HEADER = bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0);
const GIF89_HEADER = bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0);
const WEBP_HEADER = bytes(
  0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0,
  0x57, 0x45, 0x42, 0x50, 0, 0,
);
const MP4_HEADER = bytes(0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0, 0);
const WEBM_HEADER = bytes(0x1a, 0x45, 0xdf, 0xa3, 0, 0);
const WOFF_HEADER = bytes(0x77, 0x4f, 0x46, 0x46, 0, 0);
const WOFF2_HEADER = bytes(0x77, 0x4f, 0x46, 0x32, 0, 0);
const TTF_HEADER = bytes(0x00, 0x01, 0x00, 0x00, 0, 0);
const SVG_BYTES = new TextEncoder().encode(
  '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"></svg>',
);
const SVG_NO_XML = new TextEncoder().encode("<svg></svg>");

describe("detectMimeFromMagic", () => {
  it.each([
    [JPEG_HEADER, "image/jpeg"],
    [PNG_HEADER, "image/png"],
    [GIF89_HEADER, "image/gif"],
    [WEBP_HEADER, "image/webp"],
    [MP4_HEADER, "video/mp4"],
    [WEBM_HEADER, "video/webm"],
    [WOFF_HEADER, "font/woff"],
    [WOFF2_HEADER, "font/woff2"],
    [TTF_HEADER, "font/ttf"],
    [SVG_BYTES, "image/svg+xml"],
    [SVG_NO_XML, "image/svg+xml"],
  ] as const)("recognises %s", (data, mime) => {
    expect(detectMimeFromMagic(data)).toBe(mime);
  });

  it("returns null for unknown / random bytes", () => {
    expect(detectMimeFromMagic(bytes(1, 2, 3, 4, 5, 6, 7, 8))).toBeNull();
    expect(detectMimeFromMagic(new TextEncoder().encode("hello"))).toBeNull();
  });

  it("returns null for too-small input", () => {
    expect(detectMimeFromMagic(bytes(1, 2))).toBeNull();
  });
});

describe("sanitiseUploadName", () => {
  it("lowercases", () => {
    expect(sanitiseUploadName("Photo.JPG")).toBe("photo.jpg");
  });

  it("transliterates cyrillic", () => {
    expect(sanitiseUploadName("Картинка.png")).toBe("kartinka.png");
  });

  it("replaces non-allowed chars with hyphen, collapses repeats", () => {
    expect(sanitiseUploadName("hello world! 👋.png")).toBe("hello-world-.png");
  });

  it("strips path components — uploads land directly in public/", () => {
    expect(sanitiseUploadName("../../etc/passwd")).toBeNull();
    expect(sanitiseUploadName("/etc/file.png")).toBe("file.png");
    expect(sanitiseUploadName("subdir/photo.png")).toBe("photo.png");
  });

  it("rejects empty / dot-only names", () => {
    expect(sanitiseUploadName("")).toBeNull();
    expect(sanitiseUploadName(".")).toBeNull();
    expect(sanitiseUploadName("..")).toBeNull();
  });

  it("rejects names containing .. (double dot)", () => {
    expect(sanitiseUploadName("foo..bar.png")).toBeNull();
  });

  it("truncates names longer than 96 chars but keeps extension", () => {
    const name = "a".repeat(120) + ".png";
    const out = sanitiseUploadName(name)!;
    expect(out.length).toBeLessThanOrEqual(96);
    expect(out.endsWith(".png")).toBe(true);
  });
});

describe("validateUpload", () => {
  const limit = 5 * 1024 * 1024;

  it("accepts a valid JPEG", () => {
    const r = validateUpload({
      filename: "Photo.jpg",
      content: JPEG_HEADER,
      sizeLimitBytes: limit,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.safeName).toBe("photo.jpg");
      expect(r.mime).toBe("image/jpeg");
    }
  });

  it("accepts a valid SVG", () => {
    const r = validateUpload({
      filename: "icon.svg",
      content: SVG_BYTES,
      sizeLimitBytes: limit,
    });
    expect(r.ok).toBe(true);
  });

  it("rejects size > limit", () => {
    const big = new Uint8Array(limit + 1);
    big.set(PNG_HEADER, 0);
    const r = validateUpload({
      filename: "x.png",
      content: big,
      sizeLimitBytes: limit,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("size-exceeded");
  });

  it("rejects forbidden extension", () => {
    const r = validateUpload({
      filename: "shell.sh",
      content: bytes(0, 0, 0, 0, 0, 0, 0, 0),
      sizeLimitBytes: limit,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("ext-not-allowed");
  });

  it("rejects extension with no body", () => {
    const r = validateUpload({
      filename: "no-ext",
      content: bytes(0, 0, 0, 0, 0, 0, 0, 0),
      sizeLimitBytes: limit,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("ext-not-allowed");
  });

  it("rejects extension/magic mismatch", () => {
    const r = validateUpload({
      filename: "fake.png",
      content: JPEG_HEADER,
      sizeLimitBytes: limit,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("magic-bytes-mismatch");
  });

  it("rejects unsanitisable filename", () => {
    const r = validateUpload({
      filename: "../escape.png",
      content: PNG_HEADER,
      sizeLimitBytes: limit,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("invalid-name");
  });

  it("ALLOWED_EXTENSIONS contains the canonical set", () => {
    for (const ext of [
      "jpg",
      "jpeg",
      "png",
      "webp",
      "gif",
      "svg",
      "mp4",
      "webm",
      "woff",
      "woff2",
      "ttf",
    ]) {
      expect(ALLOWED_EXTENSIONS).toContain(ext);
    }
  });
});
