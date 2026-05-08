// Shared `vi.mock` block for tests that hit Better Auth-protected routes.
//
// Vitest hoists `vi.mock` calls per-file, so this module can't actually mock
// for callers — it only documents the canonical mock shape. Each test that
// needs auth bypass copies the inline block from below verbatim. Keeping a
// single source of truth avoids drift.
//
// Usage (top of test file, before any module imports):
//
//   vi.mock("@/lib/auth/api-wrap", async () => {
//     const actual = await vi.importActual<
//       typeof import("@/lib/auth/api-wrap")
//     >("@/lib/auth/api-wrap");
//     // Replace protectedRoute with a thin pass-through so handlers run
//     // without going through requireSession.
//     return {
//       ...actual,
//       protectedRoute: <P>(handler: any) => async (req: Request, ctx: any) => {
//         const params = await ctx.params;
//         return handler({
//           req,
//           params,
//           session: { user: { id: "test-user", email: "test@example.com",
//             emailVerified: true, isAdmin: false }, sessionId: "test-session" },
//         });
//       },
//     };
//   });
//   vi.mock("@/lib/auth/session", () => ({
//     getRequestSession: vi.fn(async () => ({
//       user: { id: "test-user", email: "test@example.com",
//         emailVerified: true, isAdmin: false },
//       sessionId: "test-session",
//     })),
//     requireSession: vi.fn(async () => ({ ... })),
//     requireEmailVerified: vi.fn((s) => s),
//   }));
//   vi.mock("@/lib/auth/authorization", () => ({
//     requirePermission: vi.fn(async () => ({})),
//     getProjectAccessContext: vi.fn(async () => ({
//       projectId: "test-proj", organizationId: "test-org",
//       effectiveRoleId: "test-role",
//       permissions: new Set(["project.view", "project.edit"]),
//     })),
//   }));
//   vi.mock("@/lib/db/queries/projects", () => ({
//     getProjectByGiteaWrapperId: vi.fn(async (id: string) => ({
//       id: "test-proj", organizationId: "test-org",
//       giteaRepoId: id, giteaWrapperRepoId: id,
//     })),
//   }));

export const TEST_USER_SESSION = {
  user: {
    id: "test-user",
    email: "test@example.com",
    emailVerified: true,
    isAdmin: false,
  },
  sessionId: "test-session",
};
