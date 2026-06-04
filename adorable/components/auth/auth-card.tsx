import type { ReactNode } from "react";
import Link from "next/link";

// Auth-page card frame: Adorable wordmark on top, title, child form, footer
// link. Used by every page under app/(auth)/* so the chrome stays consistent.
export function AuthCard({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col items-center gap-2">
        <Link href="/" className="flex items-center gap-2" aria-label="Adorable">
          <svg
            width="26"
            height="20"
            viewBox="0 0 28 22"
            fill="none"
            className="text-coral"
            aria-hidden
          >
            <line x1="6" y1="3" x2="22" y2="3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <line x1="4" y1="7" x2="24" y2="7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <path d="M3 21 A11 11 0 0 1 25 21 Z" fill="currentColor" />
          </svg>
          <span className="text-xl font-bold tracking-tight text-ink">
            Adorable
          </span>
        </Link>
      </div>
      <div className="rounded-[var(--r-lg)] border border-cream-deep bg-paper p-6 shadow-[var(--sh-md)]">
        <div className="mb-5 flex flex-col gap-1">
          <h1 className="font-display text-2xl font-medium leading-tight text-ink">
            {title}
          </h1>
          {subtitle ? <p className="text-sm text-n-500">{subtitle}</p> : null}
        </div>
        {children}
      </div>
      {footer ? (
        <div className="text-center text-sm text-n-500">{footer}</div>
      ) : null}
    </div>
  );
}
