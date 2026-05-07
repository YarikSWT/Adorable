import Link from "next/link";
import { AuthCard } from "@/components/auth/auth-card";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const firstStr = (
  v: string | string[] | undefined,
): string | undefined => (Array.isArray(v) ? v[0] : v);

const PROVIDER_LABELS: Record<string, string> = {
  email: "email и пароль",
  google: "Google",
  yandex: "Yandex",
  vk: "VK",
};

const labelFor = (raw?: string): string => {
  if (!raw) return "другой способ";
  return PROVIDER_LABELS[raw.toLowerCase()] ?? raw;
};

export default async function AccountConflictPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const requestedProvider = firstStr(params["provider"]);
  const existingProvider = firstStr(params["existingProvider"]);
  const email = firstStr(params["email"]);
  const requested = labelFor(requestedProvider);
  const existing = labelFor(existingProvider);
  const loginHref = email
    ? `/login?email=${encodeURIComponent(email)}`
    : "/login";

  return (
    <AuthCard
      title="Аккаунт уже существует"
      subtitle={
        email
          ? `Email ${email} уже привязан к существующему аккаунту.`
          : undefined
      }
    >
      <div className="flex flex-col gap-4 text-sm">
        <p>
          Похоже, у вас уже есть аккаунт, привязанный через{" "}
          <strong>{existing}</strong>. Чтобы войти через{" "}
          <strong>{requested}</strong>, сначала войдите старым способом и
          привяжите этого провайдера в настройках.
        </p>
        <Link
          href={loginHref}
          className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 font-medium text-primary-foreground hover:bg-primary/90"
        >
          Войти существующим способом
        </Link>
        <p className="text-xs text-muted-foreground">
          Не помните, как регистрировались?{" "}
          <Link
            href="/forgot-password"
            className="text-primary hover:underline"
          >
            Восстановить доступ по email
          </Link>
          .
        </p>
      </div>
    </AuthCard>
  );
}
