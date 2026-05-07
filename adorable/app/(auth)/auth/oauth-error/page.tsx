import Link from "next/link";
import { AuthCard } from "@/components/auth/auth-card";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const firstStr = (
  v: string | string[] | undefined,
): string | undefined => (Array.isArray(v) ? v[0] : v);

const REASON_LABELS: Record<string, string> = {
  access_denied: "Вы отклонили запрос разрешений у провайдера.",
  invalid_state: "Срок ссылки истёк или была попытка повтора.",
  invalid_token: "Провайдер вернул некорректный токен.",
  network: "Не удалось связаться с провайдером.",
  provider_not_found: "Этот способ входа сейчас не настроен.",
};

export default async function OAuthErrorPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const reason = firstStr(params["reason"]);
  const message =
    (reason && REASON_LABELS[reason]) ??
    "Что-то пошло не так при входе через провайдера.";

  return (
    <AuthCard
      title="Не удалось войти через провайдера"
      subtitle={message}
    >
      <Link
        href="/login"
        className="inline-flex h-9 w-full items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
      >
        Вернуться ко входу
      </Link>
    </AuthCard>
  );
}
