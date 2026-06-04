import Link from "next/link";

// Sunbaked 404. Fixed full-viewport so it reads cleanly regardless of the
// surrounding app shell.
export default function NotFound() {
  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center px-6 text-center"
      style={{
        background:
          "radial-gradient(ellipse at 90% 0%, var(--cream) 0%, transparent 55%), var(--paper)",
      }}
    >
      <p className="mb-3 font-mono text-xs tracking-[0.14em] text-coral uppercase">
        Error 404
      </p>
      <h1 className="font-display text-[120px] leading-none font-medium text-ink [font-variation-settings:'opsz'_144] md:text-[160px]">
        404
      </h1>
      <h2 className="mt-4 font-display text-2xl font-medium text-ink">
        Page not found
      </h2>
      <p className="mt-2 max-w-md text-sm text-n-500">
        The page you’re looking for doesn’t exist or may have been moved.
      </p>
      <Link
        href="/"
        className="mt-7 inline-flex h-10 items-center justify-center rounded-[var(--r-sm)] bg-ink px-5 text-sm font-medium text-cream transition-colors hover:bg-ink-2"
      >
        Go home
      </Link>
    </div>
  );
}
