// Wipe + migrate + seed. Used by tests and for the first DB bootstrap.
//
// Drops the public schema and recreates it, runs Drizzle migrations against
// the fresh DB, then invokes the seeders in run.ts. Always uses DATABASE_URL
// from env — there's no plain-text guard against prod here, so callers are
// expected to point this at a dev/test database.

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { __resetDbSingleton } from "../client";

const HERE = dirname(fileURLToPath(import.meta.url));
import { seedRolesPermissions } from "./roles-permissions";
import { seedPlans } from "./plans";
import { seedInitialAdmin } from "./admin";

const main = async (): Promise<void> => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");

  // 1. wipe — separate connection so we don't poison the migrator state
  const wipeClient = postgres(url, { max: 1 });
  try {
    await wipeClient`DROP SCHEMA IF EXISTS public CASCADE`;
    await wipeClient`CREATE SCHEMA public`;
    // Drizzle keeps its migration history in the `drizzle` schema; if we
    // wipe public but leave that intact, the next migrate() call sees
    // entries in __drizzle_migrations and skips re-applying everything.
    await wipeClient`DROP SCHEMA IF EXISTS drizzle CASCADE`;
    // postgres-js doesn't let `GRANT` use parameters cleanly; the default
    // owner already has full rights, so we don't re-grant here.
  } finally {
    await wipeClient.end({ timeout: 5 });
  }

  // 2. migrate
  const migrateClient = postgres(url, { max: 1 });
  try {
    const dbForMigrate = drizzle(migrateClient);
    await migrate(dbForMigrate, {
      migrationsFolder: resolve(HERE, "../migrations"),
    });
  } finally {
    await migrateClient.end({ timeout: 5 });
  }

  // 3. seed — uses the global drizzle singleton from lib/db/client.ts
  await seedRolesPermissions();
  console.log("[reset] roles + permissions ✓");
  await seedPlans();
  console.log("[reset] plans ✓");
  await seedInitialAdmin();
  console.log("[reset] admin ✓ (or skipped)");
  await __resetDbSingleton();
};

main()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error("[reset] failed:", err);
    process.exit(1);
  });
