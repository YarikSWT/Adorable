import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthCard } from "@/components/auth/auth-card";
import { OAuthButtons, OAuthSeparator } from "@/components/auth/oauth-buttons";
import { SignupForm } from "./signup-form";
import { getRequestSession } from "@/lib/auth/session";

export default async function SignupPage() {
  const session = await getRequestSession();
  if (session) redirect("/");
  return (
    <AuthCard
      title="Создать аккаунт"
      footer={
        <>
          Уже есть аккаунт?{" "}
          <Link href="/login" className="font-medium text-primary hover:underline">
            Войти
          </Link>
        </>
      }
    >
      <OAuthButtons />
      <OAuthSeparator />
      <SignupForm />
    </AuthCard>
  );
}
