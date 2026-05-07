import Link from "next/link";
import { AuthCard } from "@/components/auth/auth-card";
import { ResetPasswordForm } from "./reset-password-form";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const firstStr = (
  v: string | string[] | undefined,
): string | undefined => (Array.isArray(v) ? v[0] : v);

// We can only validate the token by attempting the reset (Better Auth doesn't
// expose a "is this token valid?" probe). So the page renders the form
// optimistically when ?token= is present; an error from POST surfaces under
// the inputs. Without ?token= we render the explicit error variant.
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const token = firstStr(params["token"]);

  if (!token) {
    return (
      <AuthCard
        title="Ссылка недействительна"
        subtitle="Похоже, в ссылке нет токена восстановления — возможно, она была обрезана."
      >
        <Link
          href="/forgot-password"
          className="inline-flex h-9 w-full items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Запросить новую
        </Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Новый пароль">
      <ResetPasswordForm token={token} />
    </AuthCard>
  );
}
