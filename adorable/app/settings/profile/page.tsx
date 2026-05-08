import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema/users";
import { getRequestSession } from "@/lib/auth/session";
import { ProfileForm } from "./profile-form";

export default async function ProfilePage() {
  const session = await getRequestSession();
  if (!session) return null;
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
    })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);
  const u = rows[0];
  if (!u) return null;
  return (
    <div className="max-w-xl">
      <h1 className="mb-4 text-lg font-semibold">Профиль</h1>
      <ProfileForm
        initialName={u.name ?? ""}
        email={u.email}
      />
    </div>
  );
}
