// Live verification of the metadata→Postgres migration using the REAL production
// code (repo-storage readRepoMetadata/writeRepoMetadata + migrateAllMetadata)
// against a real Postgres. Run: DATABASE_URL=... npx tsx scripts/verify-metadata-pg.ts

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { randomUUID } from "node:crypto";
import * as schema from "@/lib/db/schema";
import { users } from "@/lib/db/schema/users";
import { organizations } from "@/lib/db/schema/organizations";
import { projects } from "@/lib/db/schema/projects";
import { readRepoMetadata, writeRepoMetadata } from "@/lib/repo-storage";
import {
  migrateAllMetadata,
  type MetadataMigrationSource,
} from "@/lib/db/migrate-metadata-from-gitea";
import { db } from "@/lib/db/client";

const ok = (label: string, cond: boolean) =>
  console.log(`${cond ? "PASS" : "FAIL"}: ${label}`);

async function main() {
  const url = process.env.DATABASE_URL!;
  const sql = postgres(url, { max: 4 });
  const adb = drizzle(sql, { schema });
  await migrate(adb, { migrationsFolder: "lib/db/migrations" });

  // Seed user/org/project (raw — this is the project the production code resolves).
  const [u] = await adb.insert(users).values({ email: `verify-${Date.now()}@x.com` } as never).returning({ id: users.id });
  const [o] = await adb.insert(organizations).values({ type: "personal", slug: `o-${Date.now()}`, name: "V", ownerUserId: u.id } as never).returning({ id: organizations.id });
  const [p] = await adb.insert(projects).values({ organizationId: o.id, slug: `p-${Date.now()}`, name: "V proj", createdByUserId: u.id } as never).returning({ id: projects.id });
  const projectId = p.id;

  // 1) Production writeRepoMetadata → projects.metadata (Postgres), readRepoMetadata back.
  const meta = {
    version: 2 as const,
    sourceRepoId: "adorable-src-xyz",
    name: "V proj",
    vm: { vmId: "vm1", previewUrl: "http://prev", devCommandTerminalUrl: "", additionalTerminalsUrl: "" },
    conversations: [],
    deployments: [],
    productionDomain: null,
    productionDeploymentId: null,
    boilerplateVersion: "1.0.0",
    preview: { provider: "static" as const, capabilities: { shellAccess: false, customDependencies: false, serverRuntime: false, hotReload: true, manualRebuild: true }, createdAt: "2026-01-01T00:00:00Z", migrationStatus: "ok" as const },
  };
  await writeRepoMetadata(projectId, meta);

  // Verify it physically landed in the projects.metadata jsonb column.
  const rows = await adb.select({ metadata: projects.metadata }).from(projects).where((await import("drizzle-orm")).eq(projects.id, projectId));
  const stored = rows[0].metadata as { sourceRepoId?: string; preview?: { provider?: string } };
  ok("writeRepoMetadata persisted to projects.metadata (Postgres)", stored?.sourceRepoId === "adorable-src-xyz");
  ok("preview block stored in Postgres", stored?.preview?.provider === "static");

  // Production readRepoMetadata returns it (uses the app db singleton → DATABASE_URL).
  const readBack = await readRepoMetadata(projectId);
  ok("readRepoMetadata returns metadata from Postgres", readBack?.sourceRepoId === "adorable-src-xyz");
  ok("readRepoMetadata preview round-trips", readBack?.preview?.provider === "static");
  ok("boilerplateVersion round-trips", readBack?.boilerplateVersion === "1.0.0");

  // 2) The Gitea→PG migration is idempotent.
  const p2 = await adb.insert(projects).values({ organizationId: o.id, slug: `p2-${Date.now()}`, name: "V2", createdByUserId: u.id } as never).returning({ id: projects.id });
  const convId = randomUUID();
  const source: MetadataMigrationSource = {
    listProjects: async () => [{
      projectId: p2[0].id,
      metadataBlob: { ...meta, name: "Migrated" },
      conversations: [{ conversationId: convId, userId: u.id, title: "legacy", messages: [
        { id: "m1", role: "user", parts: [{ type: "text", text: "hi" }] },
        { id: "m2", role: "assistant", parts: [{ type: "text", text: "hello" }, { type: "tool-x", toolCallId: "t", state: "output-available", input: {}, output: {} }] },
      ] as never }],
    }],
  };
  const first = await migrateAllMetadata(adb, source);
  ok("migration migrated 1 project + 2 messages", first.projectsMigrated === 1 && first.messagesInserted === 2);
  const second = await migrateAllMetadata(adb, source);
  ok("migration idempotent (re-run skips, 0 migrated)", second.projectsMigrated === 0 && second.projectsSkipped === 1);

  // readRepoMetadata for the migrated project returns blob + assembled conversation.
  const migratedMeta = await readRepoMetadata(p2[0].id);
  ok("migrated project readRepoMetadata has the conversation", (migratedMeta?.conversations.length ?? 0) === 1);

  await sql.end({ timeout: 5 });
  // app db singleton may hold a separate pool — close it too.
  try { const { __resetDbSingleton } = await import("@/lib/db/client"); await __resetDbSingleton(); } catch {}
  void db;
  console.log("DONE");
}
main().catch((e) => { console.error("ERR", e); process.exit(1); });
