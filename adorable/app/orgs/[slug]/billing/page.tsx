import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { organizations } from "@/lib/db/schema/organizations";
import { getRequestSession } from "@/lib/auth/session";
import { requirePermission } from "@/lib/auth/authorization";
import { BillingClient } from "./billing-client";

export default async function BillingPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const session = await getRequestSession();
  if (!session) redirect(`/login?from=/orgs/${slug}/billing`);
  const orgRows = await db
    .select({ id: organizations.id, name: organizations.name, type: organizations.type })
    .from(organizations)
    .where(eq(organizations.slug, slug))
    .limit(1);
  const org = orgRows[0];
  if (!org) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        Организация не найдена.
      </div>
    );
  }
  // organization.billing.view — owner и admin. requirePermission throws
  // 404/403 — convert to a friendly inline message.
  try {
    await requirePermission(session.user.id, "organization.billing.view", {
      organizationId: org.id,
    });
  } catch {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        Нет доступа к биллингу этой организации.
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-4xl p-6">
      <h1 className="mb-4 text-xl font-semibold">Billing — {org.name}</h1>
      <BillingClient orgId={org.id} />
    </div>
  );
}
