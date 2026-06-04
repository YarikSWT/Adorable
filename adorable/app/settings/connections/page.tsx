import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { accounts } from "@/lib/db/schema/accounts";
import { users } from "@/lib/db/schema/users";
import { getRequestSession } from "@/lib/auth/session";
import { ConnectionsClient } from "./connections-client";

export default async function ConnectionsPage() {
  const session = await getRequestSession();
  if (!session) return null;
  const user = await db
    .select({ passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);
  // Better Auth stores credential hashes on `accounts` table with provider
  // "credential". We treat presence of a credential-account OR our legacy
  // users.passwordHash as "user has a password".
  const accountRows = await db
    .select({
      id: accounts.id,
      provider: accounts.provider,
    })
    .from(accounts)
    .where(eq(accounts.userId, session.user.id));
  const linkedSet = new Set(accountRows.map((a) => a.provider));
  const hasPassword =
    Boolean(user[0]?.passwordHash) || linkedSet.has("credential");

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-1 font-display text-2xl font-medium text-ink">
        Подключения
      </h1>
      <p className="mb-6 text-sm text-n-500">
        Один OAuth-аккаунт может быть привязан только к одному пользователю
        Adorable. Если попробуете привязать аккаунт, который уже используется
        кем-то ещё — получите ошибку.
      </p>
      <ConnectionsClient
        linkedProviders={[...linkedSet]}
        hasPassword={hasPassword}
      />
    </div>
  );
}
