import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { organizations } from "@/lib/db/schema/organizations";
import { getRequestSession } from "@/lib/auth/session";
import { getOrganizationAccessContext } from "@/lib/auth/authorization";
import { OrgSettingsForm } from "./settings-form";

export default async function OrgSettingsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const session = await getRequestSession();
  if (!session) redirect(`/login?from=/orgs/${slug}/settings`);
  const rows = await db
    .select()
    .from(organizations)
    .where(eq(organizations.slug, slug))
    .limit(1);
  const org = rows[0];
  if (!org || org.type === "personal") {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        Организация не найдена.
      </div>
    );
  }
  const access = await getOrganizationAccessContext(session.user.id, org.id);
  if (!access) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        Организация не найдена.
      </div>
    );
  }
  const canDelete = access.permissions.has("organization.delete");

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="mb-4 text-xl font-semibold">Settings — {org.name}</h1>
      <OrgSettingsForm
        orgId={org.id}
        initialName={org.name}
        initialSlug={org.slug}
        canDelete={canDelete}
      />
    </div>
  );
}
