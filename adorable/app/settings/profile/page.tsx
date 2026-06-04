import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema/users";
import { getRequestSession } from "@/lib/auth/session";
import { Card } from "@/components/ui/card";
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
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-1 font-display text-2xl font-medium text-ink">
        Профиль
      </h1>
      <p className="mb-6 text-sm text-n-500">
        Управляйте своим именем и адресом email.
      </p>
      <Card>
        <ProfileForm initialName={u.name ?? ""} email={u.email} />
      </Card>
    </div>
  );
}
