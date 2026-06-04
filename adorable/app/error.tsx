"use client";

// Sunbaked root error boundary. Fixed full-viewport, warm, with a retry.
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center px-6 text-center"
      style={{
        background:
          "radial-gradient(ellipse at 90% 0%, var(--cream) 0%, transparent 55%), var(--paper)",
      }}
    >
      <p className="mb-3 font-mono text-xs tracking-[0.14em] text-danger uppercase">
        Something went wrong
      </p>
      <h1 className="font-display text-3xl font-medium text-ink md:text-4xl">
        An unexpected error occurred
      </h1>
      <p className="mt-2 max-w-md text-sm text-n-500">
        {error?.message || "Please try again. If the problem persists, contact support."}
      </p>
      <div className="mt-7 flex items-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="inline-flex h-10 items-center justify-center rounded-[var(--r-sm)] bg-ink px-5 text-sm font-medium text-cream transition-colors hover:bg-ink-2"
        >
          Try again
        </button>
        <a
          href="/"
          className="inline-flex h-10 items-center justify-center rounded-[var(--r-sm)] border border-cream-deep bg-paper px-5 text-sm font-medium text-ink transition-colors hover:bg-cream"
        >
          Go home
        </a>
      </div>
    </div>
  );
}
