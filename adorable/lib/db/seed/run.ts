// Seed entrypoint — `npm run db:seed`.
//
// Idempotent: each step uses ON CONFLICT DO NOTHING semantics, so re-runs
// just no-op. Order matters: roles/permissions first (admin seed needs the
// superadmin role to exist), then plans, then admin.
//
// Env loading: invoke via `tsx --env-file-if-exists=.env` (already wired in
// adorable/package.json scripts). When run from the repo root, the workspace
// .env still gets picked up because tsx resolves env paths relative to CWD.

import { __resetDbSingleton } from "../client";
import { seedRolesPermissions } from "./roles-permissions";
import { seedPlans } from "./plans";
import { seedInitialAdmin } from "./admin";

const main = async (): Promise<void> => {
  await seedRolesPermissions();
  console.log("[seed] roles + permissions ✓");
  await seedPlans();
  console.log("[seed] plans ✓");
  await seedInitialAdmin();
  console.log("[seed] admin ✓ (or skipped)");
  await __resetDbSingleton();
};

main()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error("[seed] failed:", err);
    process.exit(1);
  });
