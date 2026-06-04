// DB test helpers for the agent-loop integration tests: apply the real drizzle
// migrations to a Testcontainers Postgres and seed a minimal FK-valid project
// graph (user → org → project → conversation [→ run]).
//
// Gated callers must check RUN_CONTAINER_TESTS=1.

import path from "node:path";
import postgres from "postgres";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "@/lib/db/schema";
import { users } from "@/lib/db/schema/users";
import { organizations } from "@/lib/db/schema/organizations";
import { projects } from "@/lib/db/schema/projects";
import { conversations } from "@/lib/db/schema/conversations";
import { messages } from "@/lib/db/schema/messages";
import { runs } from "@/lib/db/schema/runs";
import type { UIMessage } from "ai";

export type TestDB = PostgresJsDatabase<typeof schema>;

export interface TestDbHandle {
  db: TestDB;
  client: ReturnType<typeof postgres>;
  end: () => Promise<void>;
}

const MIGRATIONS_DIR = path.resolve(__dirname, "../../lib/db/migrations");

/** Connect to `url`, run all drizzle migrations, return a drizzle handle. */
export async function connectAndMigrate(url: string): Promise<TestDbHandle> {
  const client = postgres(url, { max: 4 });
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return {
    db,
    client,
    end: async () => {
      await client.end({ timeout: 5 });
    },
  };
}

export interface SeededGraph {
  userId: string;
  organizationId: string;
  projectId: string;
  conversationId: string;
}

/** Insert a minimal FK-valid user/org/project/conversation graph. */
export async function seedProjectGraph(
  db: TestDB,
  suffix = "1",
): Promise<SeededGraph> {
  const [user] = await db
    .insert(users)
    .values({ email: `test-${suffix}-${Date.now()}@example.com` } as never)
    .returning({ id: users.id });

  const [org] = await db
    .insert(organizations)
    .values({
      type: "personal",
      slug: `org-${suffix}-${Date.now()}`,
      name: `Org ${suffix}`,
      ownerUserId: user.id,
    } as never)
    .returning({ id: organizations.id });

  const [project] = await db
    .insert(projects)
    .values({
      organizationId: org.id,
      slug: `proj-${suffix}-${Date.now()}`,
      name: `Project ${suffix}`,
      createdByUserId: user.id,
    } as never)
    .returning({ id: projects.id });

  const [conversation] = await db
    .insert(conversations)
    .values({ projectId: project.id, userId: user.id })
    .returning({ id: conversations.id });

  return {
    userId: user.id,
    organizationId: org.id,
    projectId: project.id,
    conversationId: conversation.id,
  };
}

/** Insert a user message into the conversation (the turn the worker responds to). */
export async function seedUserMessage(
  db: TestDB,
  conversationId: string,
  text = "make a counter app",
  id = `u-${Date.now()}`,
): Promise<void> {
  const uiMessage = {
    id,
    role: "user",
    parts: [{ type: "text", text }],
  } as unknown as UIMessage;
  await db.insert(messages).values({ conversationId, role: "user", uiMessage });
}

/** Insert a run row for the seeded graph (assistant messages need a runId FK). */
export async function seedRun(
  db: TestDB,
  graph: SeededGraph,
  overrides: Partial<typeof runs.$inferInsert> = {},
): Promise<string> {
  const [run] = await db
    .insert(runs)
    .values({
      userId: graph.userId,
      organizationId: graph.organizationId,
      projectId: graph.projectId,
      conversationId: graph.conversationId,
      prompt: "test prompt",
      modelKey: "mock-main",
      ...overrides,
    })
    .returning({ id: runs.id });
  return run.id;
}
