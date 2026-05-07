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
        <Link
          href="/"
          className="text-2xl font-semibold tracking-tight text-foreground"
        >
          Adorable
        </Link>
      </div>
      <div className="rounded-xl border bg-card p-6 shadow-xs">
        <div className="mb-5 flex flex-col gap-1">
          <h1 className="text-xl font-semibold leading-tight">{title}</h1>
          {subtitle ? (
            <p className="text-sm text-muted-foreground">{subtitle}</p>
          ) : null}
        </div>
        {children}
      </div>
      {footer ? (
        <div className="text-center text-sm text-muted-foreground">{footer}</div>
      ) : null}
    </div>
  );
}
