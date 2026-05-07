import { redirect } from "next/navigation";
import Link from "next/link";
import { AuthCard } from "@/components/auth/auth-card";
import { OAuthButtons, OAuthSeparator } from "@/components/auth/oauth-buttons";
import { LoginForm } from "./login-form";
import { getRequestSession } from "@/lib/auth/session";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const firstStr = (
  v: string | string[] | undefined,
): string | undefined => (Array.isArray(v) ? v[0] : v);

// Doc 3 §3.2: redirect logged-in users to / (or to ?from= if provided).
export default async function LoginPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await getRequestSession();
  const params = await searchParams;
  const from = firstStr(params["from"]);
  const prefilledEmail = firstStr(params["email"]);
  if (session) redirect(from && from.startsWith("/") ? from : "/");

  return (
    <AuthCard
      title="Войти в Adorable"
      footer={
        <>
          Нет аккаунта?{" "}
          <Link href="/signup" className="font-medium text-primary hover:underline">
            Зарегистрироваться
          </Link>
        </>
      }
    >
      <OAuthButtons />
      <OAuthSeparator />
      <LoginForm
        from={from && from.startsWith("/") ? from : "/"}
        prefilledEmail={prefilledEmail}
      />
    </AuthCard>
  );
}
