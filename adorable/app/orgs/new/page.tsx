import { redirect } from "next/navigation";
import { getRequestSession } from "@/lib/auth/session";
import { NewOrgForm } from "./new-org-form";

export default async function NewOrgPage() {
  const session = await getRequestSession();
  if (!session) redirect("/login?from=/orgs/new");
  return (
    <div className="mx-auto max-w-md p-8">
      <h1 className="mb-2 text-xl font-semibold">Создать организацию</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Команда — это отдельный workspace c общими проектами, ролями и
        биллингом. Slug идёт в URL, поэтому подбирайте короткий.
      </p>
      <NewOrgForm />
    </div>
  );
}
