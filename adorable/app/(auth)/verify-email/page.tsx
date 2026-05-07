import { AuthCard } from "@/components/auth/auth-card";
import { VerifyEmailPending } from "./verify-email-pending";
import { VerifyEmailToken } from "./verify-email-token";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const firstStr = (
  v: string | string[] | undefined,
): string | undefined => (Array.isArray(v) ? v[0] : v);

// Two modes per Doc 3 §3.6:
//   ?pending=true  — post-signup ("we sent you mail at <email>"), with
//                    re-send button on a 30s cooldown.
//   ?token=...     — auto-POSTs the token on mount; success / error UI.
// Order matters: token wins when both are present (so the verify-link from
// the email doesn't get hijacked by a stale ?pending= flag).
export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const token = firstStr(params["token"]);
  const pending = firstStr(params["pending"]) === "true";
  const email = firstStr(params["email"]);

  if (token) {
    return (
      <AuthCard title="Подтверждение email">
        <VerifyEmailToken token={token} />
      </AuthCard>
    );
  }
  if (pending) {
    return (
      <AuthCard title="Проверьте почту">
        <VerifyEmailPending email={email ?? null} />
      </AuthCard>
    );
  }
  return (
    <AuthCard
      title="Подтверждение email"
      subtitle="Откройте ссылку из письма, чтобы подтвердить адрес. Если письмо не пришло — запросите новое из настроек."
    >
      <p className="text-sm text-muted-foreground">
        Эта страница ожидает либо токен из письма, либо параметр{" "}
        <code className="rounded bg-muted px-1">?pending=true</code>.
      </p>
    </AuthCard>
  );
}
