import type { ReactNode } from "react";

// Centred ~400px card on a neutral background — Doc 3 §3.1. The route group
// `(auth)` does NOT change the URL but lets us scope this layout to login /
// signup / forgot etc. WorkspaceFrame and ApiKeyGate already detect auth
// paths and bypass themselves, so this layout sees a bare `{children}`.
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-svh w-full items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-[400px]">{children}</div>
    </div>
  );
}
