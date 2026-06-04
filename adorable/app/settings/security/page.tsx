import { SecurityClient } from "./security-client";

export default function SecurityPage() {
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-1 font-display text-2xl font-medium text-ink">
        Безопасность
      </h1>
      <p className="mb-6 text-sm text-n-500">
        Пароль и параметры входа в аккаунт.
      </p>
      <SecurityClient />
    </div>
  );
}
