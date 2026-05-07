# Спецификация: техническая реализация авторизации

**Документ 2 из 2 — детальная техническая спецификация**

Этот документ опирается на Документ 1 (`1-auth-hight-level-spec.md`) и описывает **как именно** внедрить авторизацию и multi-tenancy в текущем форке Adorable. Он содержит: набор npm-пакетов, конфиг Better Auth и Drizzle, полную TypeScript-схему БД, сигнатуры helper-ов, перечень API-эндпоинтов с DTO, описание middleware, конкретные патчи существующих файлов форка, перечень тестов, последовательность шагов миграции.

Документ 1 — что должно появиться. Документ 2 — где, как и в каких файлах.

---

## 0. Опорные точки текущего форка

Текущая кодовая база (на момент написания спеки):

- **Next.js 16** (App Router, turbopack), React 19, TypeScript, Vitest. Один npm workspace `adorable/`.
- **Postgres** под форк уже поднят (`docker-compose.yml` → `adorable-postgres-app`, `DATABASE_URL=postgres://adorable:<pwd>@localhost:5432/adorable`), но БД **пустая**: ни Drizzle, ни миграций, ни `better-auth` ещё нет.
- **Идентификация**: `adorable/lib/identity-session.ts` — UUID в cookie `adorable_identity_id` + ACL `Map<identityId, Set<repoId>>` с persistence в JSON-файле (`.adorable/acl.json`). Заменяется полностью.
- **Метаданные проекта** хранятся в Gitea **wrapper-репо** `adorable-meta-<uuid>` (JSON-файлы `metadata.json`, `conversations/*.json`) — модуль `adorable/lib/repo-storage.ts`. После внедрения авторизации это **не уходит в БД**: wrapper-репо остаются как контейнер для конверсаций и operational-метаданных, но **владение** и **доступ** переезжают в Postgres-таблицу `projects`.
- **Адаптеры** подсистем: `getGitProvider()` (Gitea), `getSandboxProvider()` (Docker), `getPreviewProvider()` (static / sandbox / mock), `streamLlmResponse()` — точки, где будут вкорячены проверки прав и расход квот.
- API-ручки, требующие защиты: `/api/repos`, `/api/repos/[repoId]/{conversations,promote,wake,production-domain}`, `/api/projects/[id]/{build-status,rebuild,upload}`, `/api/chat`, `/api/api-key`.

`BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `DATABASE_URL` уже прописаны в `.env` и `.env.example`. Их трогать не нужно, но к ним добавим OAuth-секреты (см. Раздел 4).

---

## 1. Стек и зависимости

### 1.1. Новые npm-пакеты

В `adorable/package.json`:

```jsonc
{
  "dependencies": {
    "better-auth": "^1.x",
    "drizzle-orm": "^0.36.x",
    "postgres": "^3.4.x",
    "@better-auth/drizzle-adapter": "^1.x",
    "argon2": "^0.41.x",
    "uuidv7": "^1.x",
    "zod": "^3.x"
  },
  "devDependencies": {
    "drizzle-kit": "^0.28.x"
  }
}
```

Конкретные мажоры пинить в момент установки. `zod` нужна для валидации DTO в API-ручках; `uuidv7` — для генерации хронологически сортируемых первичных ключей (`audit_log`, `usage_events`); `argon2` — для хешей API-токенов проекта (Better Auth для пароля юзера использует свой scrypt).

После первого `db:migrate` проверить, что появилась таблица `rate_limit` — её добавляет Better Auth для prod-режима хранения rate-limit состояния (см. Раздел 3.1).

### 1.2. Структура директорий

```
adorable/
  lib/
    auth/
      better-auth.ts           # инстанс auth = betterAuth({...})
      session.ts               # getRequestSession(), requireSession()
      authorization.ts         # requirePermission(), getEffectiveProjectRole()
      quotas.ts                # requireQuota(), recordUsage()
      email-normalize.ts       # normaliseEmail() — gmail dots/plus
      providers.ts             # OAuth-конфиги (google, yandex, vk)
      audit.ts                 # writeAuditLog()
    db/
      client.ts                # drizzle(postgres(DATABASE_URL))
      schema/
        index.ts               # re-export всех таблиц
        users.ts
        organizations.ts
        roles.ts
        projects.ts
        billing.ts
        publication.ts
        tokens.ts
        audit.ts
      seed/
        roles-permissions.ts   # сид ролей и пермишенов
        plans.ts               # сид плана free
        admin.ts               # создание initial admin из env
        run.ts                 # `npm run db:seed` entrypoint
  app/
    api/
      auth/[...all]/route.ts   # Better Auth handler
      orgs/route.ts
      orgs/[orgId]/...
      projects/[id]/members/route.ts
      projects/[id]/tokens/route.ts
      admin/...
drizzle.config.ts              # на уровне adorable/
```

### 1.3. Drizzle config

`adorable/drizzle.config.ts`:

```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./lib/db/schema/index.ts",
  out: "./lib/db/migrations",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
  strict: true,
  verbose: true,
});
```

### 1.4. Скрипты в `adorable/package.json`

```jsonc
"scripts": {
  "db:generate": "drizzle-kit generate",
  "db:migrate": "drizzle-kit migrate",
  "db:push": "drizzle-kit push",        // только для dev
  "db:seed": "tsx lib/db/seed/run.ts",
  "db:reset": "tsx lib/db/seed/reset.ts" // wipe + migrate + seed
}
```

`db:reset` нужен для процесса миграции (Раздел 11) и для CI.

---

## 2. Схема БД на Drizzle

Каждая таблица — отдельный файл в `adorable/lib/db/schema/`. Типы экспортируются через `InferSelectModel`/`InferInsertModel`. Все таймстемпы — `timestamp("...", { withTimezone: true, mode: "date" })`.

### 2.1. `users.ts`

```ts
import { pgTable, uuid, text, boolean, timestamp } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),                  // нормализованный
  emailRaw: text("email_raw"),                              // как ввёл юзер
  emailVerified: boolean("email_verified").notNull().default(false),
  passwordHash: text("password_hash"),                      // null при только-OAuth
  name: text("name"),
  avatarUrl: text("avatar_url"),
  isAdmin: boolean("is_admin").notNull().default(false),
  status: text("status", { enum: ["active", "suspended", "deleted"] })
    .notNull().default("active"),
  referrerId: uuid("referrer_id").references((): any => users.id),
  referralCode: text("referral_code").unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
```

### 2.2. `accounts`, `sessions`, `verification_tokens` (Better Auth-совместимо)

Better Auth по умолчанию называет таблицы `user`/`account`/`session`/`verification`. Мы перекрываем имена через опцию `tablePrefix` или поле `tableName` в `additionalFields` — настройка в Разделе 3.

```ts
// accounts.ts
export const accounts = pgTable("accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),                  // 'email' | 'google' | 'yandex' | 'vk'
  providerAccountId: text("provider_account_id").notNull(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),                             // нужен Better Auth для OIDC
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  scope: text("scope"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uniqProviderAcc: uniqueIndex("accounts_provider_account_uq")
    .on(t.provider, t.providerAccountId),
  byUser: index("accounts_user_id_idx").on(t.userId),
}));

// sessions.ts
export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),       // sha256(opaque token)
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  userAgent: text("user_agent"),
  ipAddress: text("ip_address"),                          // inet хранить как text — проще миграция
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  byUserExp: index("sessions_user_exp_idx").on(t.userId, t.expiresAt),
}));

// verification_tokens.ts
export const verificationTokens = pgTable("verification_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  type: text("type", { enum: ["email_verify", "password_reset"] }).notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
```

Better Auth требует ровно эти три таблицы (account/session/verification). Через `drizzleAdapter` (см. 3.1) маппим имена и добавляем `additionalFields` для Better Auth-зарезервированных колонок (`emailVerified`, `name`, `image` → `avatarUrl`).

### 2.3. `roles.ts` — роли, пермишены, связи

```ts
export const roles = pgTable("roles", {
  id: uuid("id").primaryKey().defaultRandom(),
  scope: text("scope", { enum: ["organization", "project", "admin"] }).notNull(),
  slug: text("slug").notNull(),                              // 'owner', 'editor', ...
  name: text("name").notNull(),
  description: text("description"),
  isSystem: boolean("is_system").notNull().default(true),
  defaultProjectRoleId: uuid("default_project_role_id")
    .references((): any => roles.id),                        // только при scope='organization'
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uniqScopeSlug: uniqueIndex("roles_scope_slug_uq").on(t.scope, t.slug),
}));

export const permissions = pgTable("permissions", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),                     // 'project.edit', 'admin.users.ban', ...
  scopeHint: text("scope_hint"),                             // для UI: 'project'|'organization'|'admin'
  name: text("name").notNull(),
  description: text("description"),
});

export const rolePermissions = pgTable("role_permissions", {
  roleId: uuid("role_id").notNull().references(() => roles.id, { onDelete: "cascade" }),
  permissionId: uuid("permission_id").notNull()
    .references(() => permissions.id, { onDelete: "cascade" }),
}, (t) => ({
  pk: primaryKey({ columns: [t.roleId, t.permissionId] }),
}));
```

### 2.4. `organizations.ts` и членство

```ts
export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  type: text("type", { enum: ["personal", "team"] }).notNull(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  ownerUserId: uuid("owner_user_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const organizationMembers = pgTable("organization_members", {
  organizationId: uuid("organization_id").notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  roleId: uuid("role_id").notNull().references(() => roles.id),
  joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.organizationId, t.userId] }),
  byUser: index("org_members_user_idx").on(t.userId),
}));

export const adminRoleAssignments = pgTable("admin_role_assignments", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  roleId: uuid("role_id").notNull().references(() => roles.id),
  grantedBy: uuid("granted_by").references(() => users.id),
  grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
}, (t) => ({
  uniq: uniqueIndex("admin_role_user_role_uq").on(t.userId, t.roleId),
}));
```

### 2.5. `projects.ts` — проекты и members

```ts
export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  description: text("description"),

  // Привязка к Gitea: id и имя репо в Gitea, владельцем которого является
  // сервисный gitea-юзер. Заменяет старый sourceRepoId/wrapperRepoId apartheid
  // из repo-storage.ts: id → src-репо в Gitea, метаданные/конверсации
  // продолжают жить в wrapper-репо, но владение и доступ — здесь.
  giteaRepoId: bigint("gitea_repo_id", { mode: "number" }),
  giteaRepoName: text("gitea_repo_name"),
  giteaWrapperRepoId: bigint("gitea_wrapper_repo_id", { mode: "number" }),
  giteaWrapperRepoName: text("gitea_wrapper_repo_name"),

  previewSubdomain: text("preview_subdomain").unique(),
  previewSubdomainLocked: boolean("preview_subdomain_locked").notNull().default(false),
  memory: text("memory").notNull().default(""),
  dataBackend: jsonb("data_backend"),                          // {type: "appwrite"|"internal", ...}
  status: text("status", { enum: ["active", "archived", "deleted"] })
    .notNull().default("active"),
  createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),

  // Поля публикации (см. 2.7) — здесь же, без отдельной таблицы.
  publishedVisibility: text("published_visibility", {
    enum: ["private", "authenticated", "public"],
  }),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  publishedSnapshotId: uuid("published_snapshot_id"),         // FK на snapshots — заполняется через ALTER
  publishedBy: uuid("published_by").references(() => users.id),
  customDomain: text("custom_domain"),
  customDomainStatus: text("custom_domain_status", {
    enum: ["pending", "verified", "live", "failed"],
  }),
  customDomainVerifiedAt: timestamp("custom_domain_verified_at", { withTimezone: true }),
}, (t) => ({
  uniqOrgSlug: uniqueIndex("projects_org_slug_uq").on(t.organizationId, t.slug),
  byOrgStatus: index("projects_org_status_idx").on(t.organizationId, t.status),
}));

export const projectMembers = pgTable("project_members", {
  projectId: uuid("project_id").notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  roleId: uuid("role_id").notNull().references(() => roles.id),
  invitedBy: uuid("invited_by").references(() => users.id),
  joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.projectId, t.userId] }),
  byUser: index("project_members_user_idx").on(t.userId),
}));
```

`giteaRepoId`/`giteaWrapperRepoId` хранят оба идентификатора, потому что текущий `repo-storage.ts` опирается на apartheid `sourceRepoId` / `wrapperRepoId` (см. ADR-016) — мы его сохраняем, иначе придётся переписать половину чата.

### 2.6. `billing.ts` — планы, подписки, override-ы, usage

```ts
export const plans = pgTable("plans", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  monthlyPriceCents: integer("monthly_price_cents").notNull().default(0),
  currency: text("currency").notNull().default("USD"),
  limits: jsonb("limits").$type<Record<string, number>>().notNull(),
  features: jsonb("features").$type<Record<string, unknown>>(),
  isPublic: boolean("is_public").notNull().default(true),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const subscriptions = pgTable("subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  planId: uuid("plan_id").notNull().references(() => plans.id),
  status: text("status", {
    enum: ["active", "past_due", "canceled", "expired"],
  }).notNull(),
  currentPeriodStart: timestamp("current_period_start", { withTimezone: true }).notNull(),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }).notNull(),
  provider: text("provider").notNull().default("manual"),
  providerSubscriptionId: text("provider_subscription_id"),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  // одна активная подписка на org через partial unique index
  uniqActive: uniqueIndex("subs_one_active_per_org")
    .on(t.organizationId)
    .where(sql`${t.status} = 'active'`),
}));

export const planOverrides = pgTable("plan_overrides", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  limits: jsonb("limits").$type<Record<string, number>>().notNull(),
  reason: text("reason"),
  grantedBy: uuid("granted_by").references(() => users.id),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  byOrg: index("plan_overrides_org_idx").on(t.organizationId),
}));

export const usageEvents = pgTable("usage_events", {
  // UUID v7 — генерим в коде через uuidv7(), не defaultRandom().
  id: uuid("id").primaryKey(),
  organizationId: uuid("organization_id").notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").references(() => users.id),
  projectId: uuid("project_id").references(() => projects.id),
  kind: text("kind").notNull(),
  amount: numeric("amount", { precision: 20, scale: 6 }).notNull(),
  unit: text("unit").notNull(),
  costCents: integer("cost_cents"),
  model: text("model"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  byOrgKindTs: index("usage_events_org_kind_ts_idx")
    .on(t.organizationId, t.kind, t.createdAt),
}));

export const usageCounters = pgTable("usage_counters", {
  organizationId: uuid("organization_id").notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  periodStart: date("period_start").notNull(),
  kind: text("kind").notNull(),
  used: numeric("used", { precision: 20, scale: 6 }).notNull().default("0"),
}, (t) => ({
  pk: primaryKey({ columns: [t.organizationId, t.periodStart, t.kind] }),
}));
```

`usage_events.id` мы **сами** генерируем как UUID v7 в коде записи (через пакет `uuidv7`) — Postgres не даёт это нативно, а нам важна хронологическая сортировка для будущей пагинации админки.

### 2.7. `tokens.ts`, `publication.ts`, `audit.ts`

```ts
// tokens.ts
export const projectTokens = pgTable("project_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: ["public", "server", "export"] }).notNull(),
  name: text("name").notNull(),
  tokenHash: text("token_hash").notNull().unique(),         // argon2id
  tokenPrefix: text("token_prefix").notNull(),              // первые 8 чарактеров после префикса
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
}, (t) => ({
  byProject: index("project_tokens_project_idx").on(t.projectId),
  byPrefix: index("project_tokens_prefix_idx").on(t.tokenPrefix),
}));

// snapshots.ts (минимальная заглушка — Раздел 3.8 Документа 1)
export const snapshots = pgTable("snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  commitHash: text("commit_hash").notNull(),
  lastMessageId: uuid("last_message_id"),
  title: text("title"),
  isMilestone: boolean("is_milestone").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// invitations.ts — структурная заглушка
export const invitations = pgTable("invitations", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  roleId: uuid("role_id").notNull().references(() => roles.id),
  invitedBy: uuid("invited_by").notNull().references(() => users.id),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  acceptedBy: uuid("accepted_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  // exactly one of organization_id / project_id is set
  exactlyOneScope: check("invitations_exactly_one_scope",
    sql`(${t.organizationId} IS NOT NULL) <> (${t.projectId} IS NOT NULL)`),
}));

// audit.ts
export const auditLog = pgTable("audit_log", {
  id: uuid("id").primaryKey(),                              // UUID v7 в коде
  actorUserId: uuid("actor_user_id").references(() => users.id),
  action: text("action").notNull(),
  targetType: text("target_type"),
  targetId: uuid("target_id"),
  organizationId: uuid("organization_id").references(() => organizations.id),
  metadata: jsonb("metadata"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  byActor: index("audit_actor_ts_idx").on(t.actorUserId, t.createdAt),
  byTarget: index("audit_target_ts_idx").on(t.targetType, t.targetId, t.createdAt),
  byOrg: index("audit_org_ts_idx").on(t.organizationId, t.createdAt),
}));
```

`projects.publishedSnapshotId` в схеме (`projects.ts`) объявлен без `references()` — circular import. Реальный FK добавляем отдельной миграцией `ALTER TABLE projects ADD CONSTRAINT projects_published_snapshot_fk FOREIGN KEY (published_snapshot_id) REFERENCES snapshots(id)`. Drizzle поддерживает это через `relations()` или через `.references((): any => snapshots.id)` с приведением — оба варианта рабочие.

### 2.8. `index.ts` — реэкспорт

```ts
export * from "./users";
export * from "./accounts";
export * from "./sessions";
export * from "./verification-tokens";
export * from "./roles";
export * from "./organizations";
export * from "./projects";
export * from "./billing";
export * from "./tokens";
export * from "./publication";
export * from "./invitations";
export * from "./audit";
```

### 2.9. Drizzle client — `lib/db/client.ts`

```ts
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const queryClient = postgres(process.env.DATABASE_URL!, {
  max: 10, idle_timeout: 30,
});
export const db = drizzle(queryClient, { schema });
export type DB = typeof db;
```

HMR-safe: оборачиваем в `globalThis.__db` (как уже сделано для других синглтонов в форке — см. `lib/git/provider-singleton.ts`).

---

## 3. Better Auth — конфигурация

### 3.1. Базовый инстанс — `lib/auth/better-auth.ts`

```ts
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@/lib/db/client";
import * as schema from "@/lib/db/schema";
import { normaliseEmail } from "./email-normalize";

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.users,
      account: schema.accounts,
      session: schema.sessions,
      verification: schema.verificationTokens,
    },
  }),
  secret: process.env.BETTER_AUTH_SECRET!,
  baseURL: process.env.BETTER_AUTH_URL!,
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,           // мы сами решаем что ему позволено без verify
    minPasswordLength: 8,
  },
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    },
  },
  // Yandex и VK — через generic OAuth-плагин (см. 3.3).
  account: {
    accountLinking: {
      enabled: false,                           // строгий режим из спеки 4.3
    },
  },
  user: {
    additionalFields: {
      emailRaw: { type: "string", required: false },
      isAdmin: { type: "boolean", required: false, defaultValue: false },
      status: { type: "string", required: false, defaultValue: "active" },
      referrerId: { type: "string", required: false },
      referralCode: { type: "string", required: false },
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,                // 7 дней
    updateAge: 60 * 60 * 24,                    // обновлять exp раз в сутки
    cookieCache: { enabled: true, maxAge: 60 * 5 },
  },
  rateLimit: {
    enabled: true,
    window: 60,            // 60 секунд
    max: 10,               // дефолт: 10 запросов в окне на IP
    customRules: {
      "/sign-in/email":     { window: 60, max: 5 },        // 5 попыток логина в минуту
      "/sign-up/email":     { window: 60 * 60, max: 5 },   // 5 регистраций в час с IP
      "/forgot-password":   { window: 60 * 60, max: 3 },
      "/verify-email":      { window: 60, max: 10 },
      "/callback/google":   { window: 60, max: 10 },
      "/callback/yandex":   { window: 60, max: 10 },
      "/callback/vk":       { window: 60, max: 10 },
    },
    storage: "memory",     // dev
    // prod: "database" — запросы пишутся в Better Auth-таблицу rate_limit
  },
  hooks: {
    before: createBeforeHooks(),                // см. 3.2
    after: createAfterHooks(),                  // см. 3.4
  },
});
```

`accountLinking.enabled: false` даёт строгий режим: если юзер регался через email и пытается войти через Google с тем же email — Better Auth вернёт ошибку конфликта, мы её перехватим в callback-роуте и покажем юзеру нужное сообщение (см. 4.3 Документа 1).

**Rate limit включён на уровне Better Auth.** Защищает от подбора паролей и спама регистраций. Жёсткие лимиты — на критичные ручки: 5 попыток логина в минуту с одного IP, 5 регистраций в час, 3 запроса восстановления пароля в час. На dev — хранение в памяти, на prod — в БД (Better Auth добавит таблицу `rate_limit` через свои миграции — после первого `db:migrate` проверить, что она появилась). При превышении возвращается 429 с заголовком `Retry-After`.

### 3.2. Email-нормализация — `lib/auth/email-normalize.ts`

```ts
const GMAIL_HOSTS = new Set(["gmail.com", "googlemail.com"]);

export const normaliseEmail = (raw: string): string => {
  const trimmed = raw.trim().toLowerCase();
  const at = trimmed.lastIndexOf("@");
  if (at < 0) return trimmed;
  let local = trimmed.slice(0, at);
  const host = trimmed.slice(at + 1);

  // Plus-aliases: vasya+test@gmail.com → vasya@gmail.com
  const plusAt = local.indexOf("+");
  if (plusAt >= 0) local = local.slice(0, plusAt);

  // Gmail dots: v.a.s.y.a@gmail.com → vasya@gmail.com
  if (GMAIL_HOSTS.has(host)) local = local.replace(/\./g, "");

  return `${local}@${host}`;
};
```

Подключение в `before`-хуке Better Auth: до записи в БД при signup и до lookup при signin **переписываем** `ctx.body.email` на нормализованный, а оригинал сохраняем в `emailRaw`. Это даёт уникальность по нормализованной форме автоматически (мы её положили в `users.email` UNIQUE).

```ts
const createBeforeHooks = () => ({
  signUpEmail: async (ctx: BeforeContext) => {
    const raw = ctx.body.email as string;
    ctx.body.emailRaw = raw;
    ctx.body.email = normaliseEmail(raw);
  },
  signInEmail: async (ctx) => {
    ctx.body.email = normaliseEmail(ctx.body.email as string);
  },
  // OAuth callback — нормализуем email из ответа провайдера до lookup'а в `accounts`
  oauthCallback: async (ctx) => {
    if (ctx.user?.email) ctx.user.email = normaliseEmail(ctx.user.email);
  },
});
```

### 3.3. Yandex и VK — generic OAuth

В Better Auth plugin `genericOAuth` принимает массив провайдеров. Конфиг в `providers.ts`:

```ts
export const yandexOAuth = {
  providerId: "yandex",
  authorizationUrl: "https://oauth.yandex.ru/authorize",
  tokenUrl: "https://oauth.yandex.ru/token",
  userInfoUrl: "https://login.yandex.ru/info?format=json",
  clientId: process.env.YANDEX_CLIENT_ID!,
  clientSecret: process.env.YANDEX_CLIENT_SECRET!,
  scopes: ["login:email", "login:info"],
  mapProfileToUser: (p: any) => ({
    id: p.id,
    email: p.default_email,
    name: p.real_name ?? p.display_name,
    image: p.default_avatar_id
      ? `https://avatars.yandex.net/get-yapic/${p.default_avatar_id}/islands-200`
      : null,
  }),
};

export const vkOAuth = {
  providerId: "vk",
  authorizationUrl: "https://id.vk.com/authorize",
  tokenUrl: "https://id.vk.com/oauth2/auth",
  userInfoUrl: "https://id.vk.com/oauth2/user_info",
  clientId: process.env.VK_CLIENT_ID!,
  clientSecret: process.env.VK_CLIENT_SECRET!,
  scopes: ["email"],
  mapProfileToUser: (p: any) => ({
    id: String(p.user.user_id),
    email: p.user.email,
    name: [p.user.first_name, p.user.last_name].filter(Boolean).join(" "),
    image: p.user.avatar,
  }),
};
```

Подключаются как `plugins: [genericOAuth({ config: [yandexOAuth, vkOAuth] })]` в `betterAuth({...})`.

### 3.4. After-хук: создание персональной организации

После успешной регистрации Better Auth создаёт `users` и `accounts`. Нам нужно дополнительно создать организацию + членство + подписку. Это делаем в `after.signUpEmail` и `after.oauthCallback` (только при первом коннекте — флаг `isNewUser` есть в ctx):

```ts
const createAfterHooks = () => ({
  signUpEmail: async (ctx) => {
    if (ctx.user?.id) await bootstrapNewUser(ctx.user.id, ctx);
  },
  oauthCallback: async (ctx) => {
    if (ctx.isNewUser && ctx.user?.id) await bootstrapNewUser(ctx.user.id, ctx);
  },
});

async function bootstrapNewUser(userId: string, ctx: AfterContext) {
  await db.transaction(async (tx) => {
    const orgOwnerRoleId = await tx.query.roles.findFirst({
      where: and(eq(roles.scope, "organization"), eq(roles.slug, "owner")),
    }).then((r) => r!.id);

    const freePlanId = await tx.query.plans.findFirst({
      where: eq(plans.slug, "free"),
    }).then((p) => p!.id);

    const [org] = await tx.insert(organizations).values({
      type: "personal",
      slug: await generateUniqueSlug(tx, userId),
      name: ctx.user.name ?? "Personal",
      ownerUserId: userId,
    }).returning();

    await tx.insert(organizationMembers).values({
      organizationId: org.id, userId, roleId: orgOwnerRoleId,
    });

    const now = new Date();
    const periodEnd = new Date(now); periodEnd.setMonth(periodEnd.getMonth() + 1);
    await tx.insert(subscriptions).values({
      organizationId: org.id, planId: freePlanId, status: "active",
      currentPeriodStart: now, currentPeriodEnd: periodEnd, provider: "manual",
    });
  });

  await writeAuditLog({ actorUserId: userId, action: "user.register" });
}
```

`generateUniqueSlug` берёт первые 24 символа `name`-slug плюс короткий хеш — slug орги виден в URL, поэтому в персональной по умолчанию его не используем активно (URL вида `/orgs/<slug>` — для team).

**Реферальная программа — заглушка структуры, без логики.** Поля `referrerId` и `referralCode` в `users` остаются для будущей реализации, но на этапе регистрации **не заполняются**. Никаких параметров `?ref=CODE` сейчас не принимаем, signup-форма реферальное поле не показывает. Полная логика реферальной программы — отдельная спека далеко в будущем (см. Документ 1, раздел 13).

### 3.5. Handler — `app/api/auth/[...all]/route.ts`

```ts
import { auth } from "@/lib/auth/better-auth";
import { toNextJsHandler } from "better-auth/next-js";

export const { GET, POST } = toNextJsHandler(auth.handler);
```

Все Better Auth-роуты (`/api/auth/sign-in`, `/api/auth/callback/google`, `/api/auth/sign-out`, ...) автоматически работают через этот catch-all.

---

## 4. Сидинг базы

`adorable/lib/db/seed/run.ts` — точка входа `npm run db:seed`. Идемпотентен, использует `INSERT ... ON CONFLICT DO NOTHING` или эквивалент в Drizzle (`.onConflictDoNothing()`).

### 4.1. Роли и пермишены — `roles-permissions.ts`

```ts
export const SYSTEM_PERMISSIONS = [
  // project scope
  { slug: "project.view",                scopeHint: "project",      name: "Просмотр проекта" },
  { slug: "project.edit",                scopeHint: "project",      name: "Редактирование кода и чата" },
  { slug: "project.publish",             scopeHint: "project",      name: "Деплой и публикация" },
  { slug: "project.tokens.manage",       scopeHint: "project",      name: "Управление API-токенами" },
  { slug: "project.members.manage",      scopeHint: "project",      name: "Управление участниками" },
  { slug: "project.delete",              scopeHint: "project",      name: "Удаление проекта" },
  { slug: "project.data.manage",         scopeHint: "project",      name: "Управление данными приложения" },
  { slug: "project.schema.manage",       scopeHint: "project",      name: "Управление схемой данных" },
  { slug: "project.functions.manage",    scopeHint: "project",      name: "Управление функциями приложения" },
  { slug: "project.logs.view",           scopeHint: "project",      name: "Просмотр логов приложения" },
  { slug: "project.domain.manage",       scopeHint: "project",      name: "Кастомный домен" },
  // organization scope
  { slug: "organization.view",           scopeHint: "organization", name: "Просмотр организации" },
  { slug: "organization.update",         scopeHint: "organization", name: "Редактирование организации" },
  { slug: "organization.members.manage", scopeHint: "organization", name: "Управление участниками org" },
  { slug: "organization.billing.view",   scopeHint: "organization", name: "Просмотр биллинга" },
  { slug: "organization.delete",         scopeHint: "organization", name: "Удаление организации" },
  { slug: "organization.projects.create", scopeHint: "organization", name: "Создание проектов" },
  // admin scope
  { slug: "admin.users.read",            scopeHint: "admin",        name: "Список юзеров" },
  { slug: "admin.users.update",          scopeHint: "admin",        name: "Редактирование юзера" },
  { slug: "admin.users.ban",             scopeHint: "admin",        name: "Бан/разбан" },
  { slug: "admin.users.delete",          scopeHint: "admin",        name: "Удаление юзера" },
  { slug: "admin.organizations.read",    scopeHint: "admin",        name: "Список организаций" },
  { slug: "admin.plans.read",            scopeHint: "admin",        name: "Просмотр планов" },
  { slug: "admin.plans.update",          scopeHint: "admin",        name: "Редактирование планов" },
  { slug: "admin.plan_overrides.manage", scopeHint: "admin",        name: "Override-ы лимитов" },
  { slug: "admin.subscriptions.manage",  scopeHint: "admin",        name: "Подписки" },
  { slug: "admin.audit.read",            scopeHint: "admin",        name: "Аудит-лог" },
  { slug: "admin.roles.manage",          scopeHint: "admin",        name: "Выдача админ-ролей" },
] as const;

export const SYSTEM_ROLES = [
  { scope: "organization", slug: "owner",     defaultProjectRole: "owner",     perms: ["organization.*", "project.view"] },
  { scope: "organization", slug: "admin",     defaultProjectRole: "publisher", perms: ["organization.view", "organization.update", "organization.members.manage", "organization.billing.view", "organization.projects.create"] },
  { scope: "organization", slug: "member",    defaultProjectRole: "viewer",    perms: ["organization.view", "organization.projects.create"] },

  { scope: "project", slug: "viewer",    perms: ["project.view"] },
  { scope: "project", slug: "editor",    perms: ["project.view", "project.edit", "project.data.manage", "project.logs.view"] },
  { scope: "project", slug: "publisher", perms: ["project.view", "project.edit", "project.publish", "project.data.manage", "project.schema.manage", "project.functions.manage", "project.logs.view", "project.tokens.manage", "project.domain.manage"] },
  { scope: "project", slug: "owner",     perms: ["project.*"] },

  { scope: "admin", slug: "superadmin", perms: ["admin.*"] },
  { scope: "admin", slug: "support",    perms: ["admin.users.read", "admin.users.update", "admin.organizations.read", "admin.plans.read", "admin.audit.read"] },
  { scope: "admin", slug: "finance",    perms: ["admin.users.read", "admin.organizations.read", "admin.plans.*", "admin.plan_overrides.manage", "admin.subscriptions.manage"] },
  { scope: "admin", slug: "content",    perms: [] },                            // placeholder
] as const;
```

Wildcards (`organization.*`, `admin.*`, `project.*`) на этапе сида разворачиваются по реальным slug-ам. В рантайме никаких wildcards — только конкретные пермишены, иначе аудит/UI замусоривается.

**Заметка про `admin.users.update` у `support`-роли**: пермишен `admin.users.update` (включая смену email) выдан саппорту, потому что это типовая саппорт-операция (юзер потерял доступ к старому ящику). Если безопасность критична — этот пермишен можно переместить только в `superadmin`, и саппорт будет эскалировать такие запросы. Решение принимается на этапе имплементации с учётом политики компании.

### 4.2. План free — `plans.ts`

```ts
await db.insert(plans).values({
  slug: "free", name: "Free", monthlyPriceCents: 0, isPublic: true,
  limits: {
    "llm.tokens.monthly": 100_000,
    "image.generations.monthly": 10,
    "stt.minutes.monthly": 5,
    "tts.chars.monthly": 5_000,
    "projects.max": 1,
    "members_per_project.max": 1,
  },
  features: { custom_domains: false },
}).onConflictDoNothing();
```

### 4.3. Initial admin — `admin.ts`

Принимает env: `INITIAL_ADMIN_EMAIL`, `INITIAL_ADMIN_PASSWORD`. Если оба не пустые и юзера с таким email нет — создаёт через **внутренний API Better Auth** (не голым insert'ом, иначе пароль не захешируется), затем выставляет `is_admin=true`, добавляет запись в `admin_role_assignments` с ролью `superadmin`. После этого `bootstrapNewUser` сделал персональную org и подписку — это нормально, у админа тоже есть личная org.

### 4.4. `db:reset`

```bash
DROP SCHEMA public CASCADE; CREATE SCHEMA public;
# затем
npm run db:migrate && npm run db:seed
```

Используется в тестах и при первой накатке (Раздел 11 Документа 1).

---

## 5. Helper-ы доступа и квот

### 5.1. Сессия — `lib/auth/session.ts`

```ts
import { auth } from "./better-auth";
import { headers } from "next/headers";

export type RequestSession = { user: { id: string; email: string; emailVerified: boolean; isAdmin: boolean }; sessionId: string } | null;

export const getRequestSession = async (): Promise<RequestSession> => {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  return {
    user: {
      id: session.user.id,
      email: session.user.email,
      emailVerified: session.user.emailVerified,
      isAdmin: (session.user as any).isAdmin === true,
    },
    sessionId: session.session.id,
  };
};

export const requireSession = async (): Promise<NonNullable<RequestSession>> => {
  const s = await getRequestSession();
  if (!s) throw new HttpError(401, "auth.unauthenticated", "Login required");
  if (s.user.email && !s.user.emailVerified) {
    // дальше зовущий код решит — для каких действий нужен verified email
  }
  return s;
};

export const requireEmailVerified = (s: NonNullable<RequestSession>) => {
  if (!s.user.emailVerified) {
    throw new HttpError(423, "auth.email_not_verified", "Подтвердите email");
  }
};
```

`HttpError` — простой класс `{status, code, message}`, ловится в общем wrapper-е API-роутов (см. 6.3).

### 5.2. Эффективная роль на проекте — `lib/auth/authorization.ts`

```ts
type ProjectAccessContext = {
  projectId: string;
  organizationId: string;
  effectiveRoleId: string;
  permissions: Set<string>;        // slug-и, развёрнутые в Set
};

export const getProjectAccessContext = async (
  userId: string, projectId: string,
): Promise<ProjectAccessContext | null> => {
  const project = await db.query.projects.findFirst({
    where: eq(projects.id, projectId),
    columns: { id: true, organizationId: true },
  });
  if (!project) return null;

  const orgMember = await db.query.organizationMembers.findFirst({
    where: and(
      eq(organizationMembers.organizationId, project.organizationId),
      eq(organizationMembers.userId, userId),
    ),
  });
  if (!orgMember) return null;

  // Дефолтная project-роль из org-роли
  const orgRole = await db.query.roles.findFirst({
    where: eq(roles.id, orgMember.roleId),
    columns: { defaultProjectRoleId: true },
  });
  const defaultProjectRoleId = orgRole?.defaultProjectRoleId ?? null;

  // Явная project-роль (если есть)
  const explicit = await db.query.projectMembers.findFirst({
    where: and(
      eq(projectMembers.projectId, projectId),
      eq(projectMembers.userId, userId),
    ),
  });

  // Роли-кандидаты: дефолтная (из org-роли) и явная (из project_members).
  const candidateRoleIds = [defaultProjectRoleId, explicit?.roleId].filter(Boolean) as string[];
  if (candidateRoleIds.length === 0) return null;

  const roleWithPerms = await loadRolePermissions(candidateRoleIds); // Map<roleId, Set<slug>>

  // Если есть только одна кандидатная роль — берём её.
  // Если две: explicit-project-роль и default-from-org.
  //   - если одна является супермножеством другой → побеждает супермножество
  //   - если они несравнимы → побеждает explicit-project-роль
  //     (администратор сознательно выдал её на этот проект)
  let bestRoleId: string;
  let bestPerms: Set<string>;

  if (candidateRoleIds.length === 1) {
    bestRoleId = candidateRoleIds[0];
    bestPerms = roleWithPerms.get(bestRoleId)!;
  } else {
    const defaultId = defaultProjectRoleId!;
    const explicitId = explicit!.roleId;
    const defaultPerms = roleWithPerms.get(defaultId)!;
    const explicitPerms = roleWithPerms.get(explicitId)!;

    if (isSuperset(explicitPerms, defaultPerms)) {
      bestRoleId = explicitId; bestPerms = explicitPerms;
    } else if (isSuperset(defaultPerms, explicitPerms)) {
      bestRoleId = defaultId; bestPerms = defaultPerms;
    } else {
      // Несравнимые наборы — explicit выигрывает.
      bestRoleId = explicitId; bestPerms = explicitPerms;
    }
  }

  return {
    projectId, organizationId: project.organizationId,
    effectiveRoleId: bestRoleId, permissions: bestPerms,
  };
};
```

Где `isSuperset(a, b)` — нестрогое супермножество (a ⊇ b), включая равенство.

**Что значит «максимум по правам»**: если одна роль является супермножеством другой — побеждает та, что включает больше пермишенов. Если роли несравнимы (ни одна не покрывает другую) — побеждает **явно назначенная** project-роль из `project_members`, потому что она представляет осознанное решение администратора проекта. Объединение пермишенов из несравнимых ролей **не делаем** — это даёт неожиданный доступ к ресурсам, на которые юзер явной роли не получал.

### 5.3. `requirePermission` — основная точка проверки

```ts
export const requirePermission = async (
  userId: string,
  permissionSlug: string,
  ctx: { projectId?: string; organizationId?: string },
): Promise<ProjectAccessContext | OrganizationAccessContext> => {
  if (ctx.projectId) {
    const access = await getProjectAccessContext(userId, ctx.projectId);
    if (!access) throw new HttpError(403, "access.denied");
    if (!access.permissions.has(permissionSlug)) {
      throw new HttpError(403, "access.denied", `Missing ${permissionSlug}`);
    }
    return access;
  }
  if (ctx.organizationId) { /* симметрично — getOrgAccessContext */ }
  throw new Error("requirePermission needs project or org context");
};

export const requireAdminPermission = async (
  userId: string, permissionSlug: string,
): Promise<void> => {
  const u = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!u?.isAdmin) throw new HttpError(403, "access.denied");
  const adminRoles = await db.query.adminRoleAssignments.findMany({
    where: and(eq(adminRoleAssignments.userId, userId),
               or(isNull(adminRoleAssignments.expiresAt),
                  gt(adminRoleAssignments.expiresAt, new Date()))),
  });
  const perms = await loadRolePermissions(adminRoles.map((r) => r.roleId));
  for (const set of perms.values()) if (set.has(permissionSlug)) return;
  throw new HttpError(403, "access.denied", `Missing admin ${permissionSlug}`);
};
```

### 5.4. Квоты — `lib/auth/quotas.ts`

```ts
export const requireQuota = async (
  organizationId: string, kind: string, estimated: number,
): Promise<{ remaining: number }> => {
  const limit = await resolveLimit(organizationId, kind);
  if (limit == null) return { remaining: Infinity };       // no limit
  const period = currentPeriodStartUTC();
  const used = await getCounter(organizationId, period, kind);
  if (used + estimated > limit) {
    throw new HttpError(402, "quota.exceeded", "Превышена квота плана", {
      quota: { kind, limit, used, period_start: period.toISOString() },
    });
  }
  return { remaining: limit - used - estimated };
};

export const recordUsage = async (event: {
  organizationId: string; userId?: string; projectId?: string;
  kind: string; amount: number; unit: string;
  costCents?: number; model?: string; metadata?: unknown;
}): Promise<void> => {
  const id = uuidv7();
  await db.transaction(async (tx) => {
    await tx.insert(usageEvents).values({ id, ...event, amount: String(event.amount) });
    const period = currentPeriodStartUTC();
    await tx.insert(usageCounters)
      .values({ organizationId: event.organizationId, periodStart: period,
                kind: event.kind, used: String(event.amount) })
      .onConflictDoUpdate({
        target: [usageCounters.organizationId, usageCounters.periodStart, usageCounters.kind],
        set: { used: sql`${usageCounters.used} + ${event.amount}` },
      });
  });
};

const resolveLimit = async (orgId: string, kind: string): Promise<number | null> => {
  const sub = await db.query.subscriptions.findFirst({
    where: and(eq(subscriptions.organizationId, orgId), eq(subscriptions.status, "active")),
    with: { plan: true },
  });
  const planLimit = sub?.plan?.limits?.[kind] ?? null;

  const overrides = await db.query.planOverrides.findMany({
    where: and(eq(planOverrides.organizationId, orgId),
               or(isNull(planOverrides.expiresAt), gt(planOverrides.expiresAt, new Date()))),
  });
  let final = planLimit;
  for (const o of overrides) if (o.limits[kind] != null) final = o.limits[kind];
  return final;
};
```

`currentPeriodStartUTC` — первое число месяца UTC. Этого достаточно для месячных лимитов; если в будущем появятся дневные/часовые — добавим свитч по `kind`-суффиксу (`.daily`, `.hourly`).

### 5.5. Аудит-лог — `lib/auth/audit.ts`

```ts
export const writeAuditLog = async (entry: {
  actorUserId?: string; action: string;
  targetType?: string; targetId?: string;
  organizationId?: string;
  metadata?: unknown;
  ipAddress?: string; userAgent?: string;
}): Promise<void> => {
  await db.insert(auditLog).values({ id: uuidv7(), ...entry }).execute();
};
```

Вызывается из всех точек, перечисленных в Разделе 10.1 Документа 1. Не падает наружу: ошибка записи аудита логируется в stderr, но не ломает основной запрос.

---

## 6. Middleware и обёртка API-роутов

### 6.1. Edge middleware — `adorable/middleware.ts`

В Next 16 App Router `middleware.ts` на корне `adorable/` запускается на каждом запросе. Используем его минимально — только для:

1. Чтения cookie сессии Better Auth, чтобы редиректить на `/login` при заходе на `/app/**` без сессии.
2. Прокидывания `x-request-id` для логов.

Тяжёлые проверки прав остаются в API-роутах, потому что middleware в Next работает на edge runtime, а Drizzle+pg-клиент — на node. Пытаться слепить edge-совместимый клиент — лишнее.

```ts
// adorable/middleware.ts
import { NextResponse } from "next/server";

export const config = {
  matcher: ["/app/:path*"],   // защищённые SPA-роуты, если они появятся
};

export const middleware = (req: Request) => {
  const cookie = req.headers.get("cookie") ?? "";
  if (!cookie.includes("better-auth.session_token")) {
    const url = new URL("/login", req.url);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
};
```

### 6.2. Universal API wrapper — `lib/auth/api-wrap.ts`

```ts
type Handler<P> = (ctx: {
  req: Request; params: P; session: NonNullable<RequestSession>;
}) => Promise<Response>;

export const protectedRoute = <P>(handler: Handler<P>) =>
  async (req: Request, route: { params: Promise<P> }): Promise<Response> => {
    const t0 = Date.now();
    try {
      const session = await requireSession();
      const params = await route.params;
      return await handler({ req, params, session });
    } catch (err) {
      return errorToResponse(err);
    } finally {
      // metrics: записать длительность под request-id
    }
  };
```

`errorToResponse` маппит `HttpError` → JSON `{ error: { code, message, ...extra } }` с правильным статусом. Все API-роуты, требующие сессии, оборачиваются им.

### 6.3. Формат ошибок

```jsonc
{
  "error": {
    "code": "quota.exceeded",
    "message": "Превышена квота плана",
    "quota": { "kind": "llm.tokens.monthly", "limit": 100000, "used": 100000, "period_start": "2026-05-01T00:00:00Z" }
  }
}
```

Коды ошибок — короткие kebab-case-точечные:

| HTTP | code | когда |
|------|------|-------|
| 401  | `auth.unauthenticated` | нет сессии |
| 423  | `auth.email_not_verified` | email не подтверждён, но требуется |
| 403  | `access.denied` | нет пермишена / членства |
| 404  | `resource.not_found` | объект не существует или не виден |
| 402  | `quota.exceeded` | пермишен есть, лимит исчерпан |
| 409  | `conflict.account_email_exists` | при OAuth с занятым email (строгий режим) |
| 422  | `validation.failed` | DTO не прошёл zod |
| 429  | `rate.limited` | превышен rate limit Better Auth |

---

## 7. API-эндпоинты

Все ручки возвращают JSON. Body — JSON. Авторизация — через Better Auth-cookie. Описываю DTO кратко: запрос → ответ → используемые проверки.

### 7.1. Auth (Better Auth даёт сам)

`/api/auth/*` — handlers Better Auth. Доступные ручки: `sign-up/email`, `sign-in/email`, `sign-out`, `callback/<provider>`, `verify-email`, `forgot-password`, `reset-password`, `link-account/<provider>`, `unlink-account/<provider>`. Их формат — стандартный для Better Auth, отдельно их не специфицируем.

### 7.2. Текущий юзер

| Метод | URL | Описание |
|------|-----|----------|
| GET  | `/api/me` | Текущий юзер + его организации + admin-флаг |
| PATCH | `/api/me` | Сменить `name`, `avatarUrl` |

```
GET /api/me  →
{
  "user": { "id", "email", "emailVerified", "name", "avatarUrl", "isAdmin", "status" },
  "organizations": [
    { "id", "slug", "name", "type", "role": "owner|admin|member", "subscription": { "planSlug": "free", "currentPeriodEnd": "..." } }
  ]
}
```

### 7.3. Организации

| Метод | URL | Permission |
|------|-----|-----------|
| POST | `/api/orgs` | (любой залогиненный с verified email) |
| GET  | `/api/orgs/:orgId` | `organization.view` |
| PATCH | `/api/orgs/:orgId` | `organization.update` |
| DELETE | `/api/orgs/:orgId` | `organization.delete` (только `team`-org, `personal` нельзя) |
| GET  | `/api/orgs/:orgId/members` | `organization.view` |
| POST | `/api/orgs/:orgId/members` | `organization.members.manage` (создаёт **invitation** в первой версии — см. 7.10) |
| PATCH | `/api/orgs/:orgId/members/:userId` | `organization.members.manage` |
| DELETE | `/api/orgs/:orgId/members/:userId` | `organization.members.manage` |
| GET  | `/api/orgs/:orgId/billing` | `organization.billing.view` |

### 7.4. Проекты (заменяет текущий `/api/repos`)

> **Важно**: текущий `/api/repos` сейчас опирается на cookie-identity и ACL-файл. После внедрения авторизации мы оставляем URL `/api/repos` для **backward-compat** в коде клиента (workspace, home), но переписываем route-handler. URL-семантика: `repoId` ↔ `projects.giteaWrapperRepoId` (в текущем коде), это сохраняем.

| Метод | URL | Permission |
|------|-----|-----------|
| GET  | `/api/repos` | (любой залогиненный, фильтр по доступным проектам) |
| POST | `/api/repos` | `organization.projects.create` (для `orgId` из тела или дефолтной personal-org); + квота `projects.max`; + `email_verified` |
| GET  | `/api/repos/:repoId` | `project.view` |
| PATCH | `/api/repos/:repoId` | `project.edit` |
| DELETE | `/api/repos/:repoId` | `project.delete` |
| GET  | `/api/repos/:repoId/conversations` | `project.view` |
| POST | `/api/repos/:repoId/conversations` | `project.edit` |
| POST | `/api/repos/:repoId/promote` | `project.publish` (= POST publication) |
| POST | `/api/repos/:repoId/wake` | `project.edit` |
| GET/PATCH | `/api/repos/:repoId/production-domain` | `project.domain.manage` |
| POST | `/api/projects/:id/rebuild` | `project.edit` |
| GET  | `/api/projects/:id/build-status` | `project.view` |
| POST | `/api/projects/:id/upload` | `project.edit` |

Параметр `:repoId` в URL `/api/repos/:repoId/*` остаётся **семантически тем же значением, что клиент передавал раньше** — это `gitea_wrapper_repo_id` (числовой Gitea-id wrapper-репо). Внутри handler-ов мы по нему делаем lookup в `projects` через `getProjectByGiteaWrapperId(wrapperRepoId)` и дальше работаем с `project.id`. Это даёт нулевой breaking change для клиентского кода workspace и home.

Параллельно появляются новые ручки `/api/projects/:id/*`, где `:id` — это уже UUID `projects.id`. Они используются для нового UI (списки проектов, настройки, members). Старые `/api/repos/:repoId/*` остаются для legacy-эндпоинтов чата и конверсаций. Со временем (отдельной спекой) можно унифицировать на `/api/projects/:id`, но не сейчас.

**Поле `memory` проекта** — в первой версии создаётся со значением `""` и **не редактируется** через API. Эндпоинт `PATCH /api/repos/:repoId/memory` появится в будущей спеке про чат, где будет описана и подача memory в системный промпт LLM, и UI редактирования.

### 7.5. Project-members

| Метод | URL | Permission |
|------|-----|-----------|
| GET  | `/api/repos/:repoId/members` | `project.view` |
| POST | `/api/repos/:repoId/members` | `project.members.manage` (создаёт invitation) |
| PATCH | `/api/repos/:repoId/members/:userId` | `project.members.manage` |
| DELETE | `/api/repos/:repoId/members/:userId` | `project.members.manage` |

### 7.6. Project-tokens

| Метод | URL | Permission |
|------|-----|-----------|
| GET  | `/api/repos/:repoId/tokens` | `project.tokens.manage` |
| POST | `/api/repos/:repoId/tokens` | `project.tokens.manage` |
| DELETE | `/api/repos/:repoId/tokens/:tokenId` | `project.tokens.manage` |

`POST` ответ — единственный момент, когда возвращается plaintext `token`:

```jsonc
{ "id": "...", "kind": "server", "name": "Mobile API", "token": "sk_live_AbCdEf123...", "tokenPrefix": "AbCdEf12", "createdAt": "..." }
```

`tokenHash` = `argon2id(token)`. При входящем запросе с `Authorization: Bearer <token>`:

1. Префикс `tokenPrefix` (8 chars после `sk_live_`/`pk_live_`/`xp_live_`) — индексирован, по нему ищем кандидатов.
2. Argon2 verify по каждому кандидату.
3. Обновляем `lastUsedAt`, проверяем `revokedAt`, `expiresAt`.

### 7.7. Публикация

`POST /api/repos/:repoId/promote` (текущая ручка остаётся) теперь:

1. `requirePermission(userId, "project.publish", { projectId })`.
2. `requireQuota(orgId, "deploy.builds.monthly", 1)` — если ввести лимит на билды (опционально).
3. Создать запись в `snapshots` (commit_hash из текущего HEAD source-репо, `last_message_id` пока null).
4. Обновить в `projects`: `published_visibility` (из body, default `private`), `published_at`, `published_snapshot_id`, `published_by`. Если `preview_subdomain` пуст — сгенерить и зафиксировать `preview_subdomain_locked = true`.
5. Дёрнуть build-queue (`getPreviewProvider().promote()` — уже есть в форке).
6. `writeAuditLog({ action: "project.publish", targetType: "project", targetId, organizationId })`.

`PATCH /api/repos/:repoId/visibility` (новая ручка) — смена видимости без билда. Поле `published_visibility` обновляется одним UPDATE.

### 7.8. Caddy и проверка видимости

Ручка-`gateway` для опубликованных приложений:

```
GET /__published/:subdomain/*
```

— внутренний Next-route, на который Caddy форвардит запросы к `*.preview.<домен>` **до** отдачи статики.

Логика: `public` отдаётся всем, `authenticated` и `private` требуют валидной сессии **и** подтверждённого email. Юзер с не подтверждённым email при попытке открыть `authenticated`/`private` — редирект на страницу логина с подсказкой «подтвердите email». Это единое правило для всех уровней выше `public` и согласовано с Документом 1 (раздел 7.4).

```ts
// псевдокод
const project = await db.query.projects.findFirst({
  where: eq(projects.previewSubdomain, subdomain),
  columns: { id, organizationId, publishedVisibility, publishedSnapshotId },
});
if (!project || !project.publishedSnapshotId) return new Response("Not found", { status: 404 });

switch (project.publishedVisibility) {
  case "public": return passthrough();
  case "authenticated": {
    const s = await getRequestSession();
    if (!s || !s.user.emailVerified) return redirectToLogin(req);
    return passthrough();
  }
  case "private": {
    const s = await getRequestSession();
    if (!s) return redirectToLogin(req);
    if (!s.user.emailVerified) return redirectToLogin(req); // или 423-страница
    const access = await getProjectAccessContext(s.user.id, project.id);
    if (!access) return new Response("Forbidden", { status: 403 });
    return passthrough();
  }
}
```

Технически: Caddy матчит wildcard subdomain → проксирует на `next-server:3000/__published/<subdomain>/<path>`. `passthrough()` возвращает `307 Location` на статический бакет (или `Caddy.handleStatic()` через `X-Accel-Redirect`/`internal: true`). Конкретный механизм зависит от того, как организован static-серв в `lib/preview/build-runner-docker.ts` — текущий код кладёт собранный бандл в директорию, доступную Caddy; мы добавляем gateway-проверку перед отдачей.

### 7.9. Биллинг (плательщик заглушка)

| Метод | URL | Permission |
|------|-----|-----------|
| GET  | `/api/orgs/:orgId/usage` | `organization.billing.view` |
| GET  | `/api/plans` | (публичная) |

`GET /api/orgs/:orgId/usage` возвращает:

```jsonc
{
  "period": { "start": "2026-05-01", "end": "2026-06-01" },
  "limits": { "llm.tokens.monthly": 100000, ... },
  "used":   { "llm.tokens.monthly": 42500, ... },
  "events": { "total": 173, "lastEventAt": "2026-05-07T12:34:56Z" }
}
```

### 7.10. Invitations (структурно — без UI)

`POST /api/orgs/:orgId/invitations` создаёт запись в `invitations`, генерирует токен, отправляет email (через ту же отправку, что Better Auth для verify). UI приёма приглашения в первой версии **не делается** — только эндпоинт `POST /api/invitations/accept` с `{token}`, чтобы можно было вручную тестировать flow. Это и есть выполнение заглушки из Раздела 3.9 Документа 1.

### 7.11. Admin API

Префикс `/api/admin/*`. Каждый эндпоинт — `requireAdminPermission(userId, "admin.<...>")`.

| Метод | URL | Permission |
|------|-----|-----------|
| GET  | `/api/admin/users` | `admin.users.read` |
| PATCH | `/api/admin/users/:id` | `admin.users.update` |
| POST | `/api/admin/users/:id/suspend` | `admin.users.ban` |
| POST | `/api/admin/users/:id/unsuspend` | `admin.users.ban` |
| DELETE | `/api/admin/users/:id` | `admin.users.delete` |
| GET  | `/api/admin/orgs` | `admin.organizations.read` |
| GET  | `/api/admin/orgs/:id` | `admin.organizations.read` |
| GET  | `/api/admin/plans` | `admin.plans.read` |
| PATCH | `/api/admin/plans/:id` | `admin.plans.update` |
| POST | `/api/admin/orgs/:id/plan-overrides` | `admin.plan_overrides.manage` |
| DELETE | `/api/admin/plan-overrides/:id` | `admin.plan_overrides.manage` |
| PATCH | `/api/admin/orgs/:id/subscription` | `admin.subscriptions.manage` |
| POST | `/api/admin/users/:id/admin-roles` | `admin.roles.manage` |
| DELETE | `/api/admin/users/:id/admin-roles/:roleId` | `admin.roles.manage` |
| GET  | `/api/admin/audit-log` | `admin.audit.read` |

**`PATCH /api/admin/users/:id`** — редактирование юзера админом. Body — частичный объект с полями: `email` (нормализуется через `normaliseEmail`, проверяется на коллизию с существующими юзерами), `name`, `avatarUrl`, `status` (`active` / `suspended` / `deleted`).

При смене email:

1. Нормализуем новый email через `normaliseEmail`.
2. Проверяем — не занят ли он другим юзером (`SELECT ... WHERE email = $1 AND id <> $2`). Если занят — 409 `conflict.email_exists`.
3. UPDATE `users` SET `email = $new`, `email_raw = $rawNew`, `email_verified = false` (сбрасываем подтверждение — на новый ящик нужен новый verify-flow).
4. Инвалидируем все активные сессии юзера (`DELETE FROM sessions WHERE user_id = $`).
5. Записываем в audit_log: `action = "user.email_change_by_admin"`, `metadata = { oldEmail, newEmail }`.
6. Опционально — отправляем уведомление на старый email («ваш email был изменён администратором»).

Тела запросов и параметры пагинации — стандартные (`?page=1&limit=50`, ответ `{ items, total, page, limit }`).

---

## 8. Интеграция с существующим кодом форка

### 8.1. Удаляется

- `adorable/lib/identity-session.ts` — целиком. Cookie `adorable_identity_id` и файл `.adorable/acl.json` больше не используются. Импорт `getOrCreateIdentitySession` заменяется на `requireSession()` + `getProjectAccessContext`/`requirePermission`.
- `migrateRepoIdInAcl` — удаляется. Замена: при rename Gitea-репо обновляем `projects.giteaWrapperRepoId` через UPDATE — это одна строка вместо итерации по всем identity.

### 8.2. Меняется

#### `adorable/app/api/repos/route.ts` (POST — создание проекта)

**До**:
```ts
const { identityId, identity } = await getOrCreateIdentitySession();
// ... создаём wrapper и source репо в Gitea, через identity.permissions.git.grant
await identity.permissions.git.grant({ permission: "all", repoId: wrapperRepoId });
```

**После**:
```ts
const session = await requireSession();
requireEmailVerified(session);

const orgId = body.organizationId ?? await getDefaultPersonalOrgId(session.user.id);
await requirePermission(session.user.id, "organization.projects.create", { organizationId: orgId });
await requireQuota(orgId, "projects.max", 1);

// В Gitea репо создаются всегда от имени **сервисного** gitea-юзера (как сейчас).
const sourceRepo = await getGitProvider().createRepo({ name: "..." });
const wrapperRepo = await getGitProvider().createRepo({ name: ADORABLE_WRAPPER_REPO_PREFIX + slug });

const projectOwnerRoleId = await getRoleId("project", "owner"); // из кеша системных ролей

const project = await db.transaction(async (tx) => {
  const [p] = await tx.insert(projects).values({
    organizationId: orgId,
    slug, name: body.name,
    giteaRepoId: sourceRepo.numericId, giteaRepoName: sourceRepo.name,
    giteaWrapperRepoId: wrapperRepo.numericId,
    giteaWrapperRepoName: wrapperRepo.name,
    createdByUserId: session.user.id,
  }).returning();

  // Создатель ВСЕГДА получает явную project-owner-роль.
  // Это работает единообразно для personal- и team-org, не зависит от
  // org-роли создателя, и переживает понижение org-роли в будущем.
  await tx.insert(projectMembers).values({
    projectId: p.id,
    userId: session.user.id,
    roleId: projectOwnerRoleId,
    invitedBy: session.user.id, // сам себя
  });

  return p;
});

await writeAuditLog({ actorUserId: session.user.id, action: "project.create",
  targetType: "project", targetId: project.id, organizationId: orgId });

await recordUsage({ organizationId: orgId, userId: session.user.id, projectId: project.id,
  kind: "projects.max", amount: 1, unit: "projects" });
```

> Создатель проекта **всегда** получает явную запись `project_members` с ролью `owner`. Это нужно по двум причинам. Первая — в team-org создатель может быть обычным member-ом с дефолтной project-ролью `viewer`, и без явной записи он сразу теряет доступ к редактированию собственного проекта. Вторая — если в будущем org-роль создателя понизят, явная project-роль сохранит его контроль над проектом, что соответствует ожиданиям.

> Замечание про `projects.max`: это не накапливаемая квота, а абсолютный лимит. Поэтому `requireQuota` для неё считает **текущее** число активных проектов в org (через SELECT COUNT) вместо `usage_counters`. В `quotas.ts` добавляется ветка для абсолютных kind-ов (по списку `ABSOLUTE_KINDS = ["projects.max", "members_per_project.max"]`).

#### `adorable/app/api/chat/route.ts`

Текущий поток: `getOrCreateIdentitySession` → дальше работа без проверки права на проект и без учёта расхода LLM.

После:
```ts
const session = await requireSession();
requireEmailVerified(session);

const repoId = body.repoId;
const project = await getProjectByGiteaWrapperId(repoId);
if (!project) throw new HttpError(404, "resource.not_found");

const access = await requirePermission(session.user.id, "project.edit",
  { projectId: project.id });

// Перед стримом — ограничивающая проверка квоты на токены.
// estimated = верхняя граница (например, 50_000 за один turn).
await requireQuota(access.organizationId, "llm.tokens.monthly", 50_000);

// Дальше — текущий streamText.
const { result, provider } = await streamLlmResponse({...});

// onFinish (есть в текущем коде): записать фактический расход.
result.onFinish = async (final) => {
  const totalTokens = (final.usage?.inputTokens ?? 0) + (final.usage?.outputTokens ?? 0);
  await recordUsage({
    organizationId: access.organizationId,
    userId: session.user.id, projectId: project.id,
    kind: "llm.tokens.monthly", amount: totalTokens, unit: "tokens",
    model: final.model, costCents: estimateCostCents(totalTokens, final.model, provider),
  });
  // плюс существующий autoCommitWorkspace
};
```

`getProjectByGiteaWrapperId` — новый helper в `lib/db/queries/projects.ts`, делает `SELECT ... WHERE gitea_wrapper_repo_id = $1`.

`estimated = 50_000` — вшитая верхняя граница на один turn. Если фактический расход превышает остаток квоты — это ОК для текущей операции (LLM уже стримила), но следующий turn будет отбит на стадии `requireQuota`. Это компромисс между fairness и UX.

#### `adorable/lib/repo-storage.ts`

`metadata.json` в Gitea wrapper-репо остаётся (там история конверсаций, deployments, preview-state — то, что специфично для проекта и удобно версионировать вместе с кодом). **Не дублируется** в БД. Вызовы `readRepoMetadata`/`writeRepoMetadata` — без изменений; меняется только аргумент: вместо `wrapperRepoId` (который раньше шёл из cookie-ACL) он берётся из `projects.giteaWrapperRepoId`.

### 8.3. Новые модули

- `lib/db/queries/projects.ts` — типизированные запросы (`getProjectByGiteaWrapperId`, `listProjectsForUser`, `getProjectAccessContext`-helpers).
- `lib/db/queries/users.ts` — `getDefaultPersonalOrgId`, `getUserOrganizations`.
- `lib/auth/api-wrap.ts` — обёртка протектед-роутов.
- `lib/auth/role-cache.ts` — кеш системных ролей при старте приложения. Экспортирует `getRoleId(scope, slug)` — синхронный lookup в Map по ключу `"<scope>:<slug>"`. Кеш загружается один раз при инициализации (или лениво при первом вызове) и не обновляется в рантайме, поскольку системные роли неизменны. При изменении ролей через админку (когда такая фича появится) — нужен механизм инвалидации кеша или его обход.
- `lib/auth/email-normalize.ts`, `lib/auth/session.ts`, `lib/auth/authorization.ts`, `lib/auth/quotas.ts`, `lib/auth/audit.ts`, `lib/auth/providers.ts`, `lib/auth/better-auth.ts`.

### 8.4. Что не меняется

- Адаптеры `lib/adapters/{llm,sandbox,git,proxy,preview}.ts` — поверх них идёт авторизация, сами адаптеры не знают про юзера. Это сохраняет тестируемость.
- Sandbox cleanup-worker, build-queue, audit-log файла sandbox'ов (`SANDBOX_AUDIT_LOG`) — независимы.
- Boilerplate Vite-template (`adorable/templates/vite-react/`).
- Caddy Admin API helpers — `lib/proxy/*`.

---

## 9. Тесты

Используем Vitest, который уже настроен. Ниже — файлы тестов, которые должны быть зелёными до релиза auth-слоя.

### 9.1. Unit (без БД)

- `tests/auth/email-normalize.test.ts` — gmail-точки, plus-aliases, googlemail.com, не-gmail-домены без модификаций, регистр, trim. ~10 кейсов.
- `tests/auth/uuidv7.test.ts` — sanity: монотонность, парсинг.

### 9.2. Integration (нужна Postgres) — gated `RUN_DB_TESTS=1`

Используем фикстуру: до каждого describe — `db:reset` в отдельную тестовую БД (`DATABASE_URL_TEST`).

- `tests/auth/db-schema.test.ts` — миграции применяются на пустой БД, базовый seed успешно сидит роли/пермишены/free-план.
- `tests/auth/authorization.test.ts`:
  - org-owner → project-owner на всех проектах своей org
  - org-member → project-viewer по умолчанию
  - explicit project-publisher для org-member-а — повышается до publisher
  - попытка downgrade через `project_members` ниже org-default — фактическое = org-default (по правилу «максимум»)
  - юзер вне org — нет доступа
  - две несравнимые роли (например, кастомная `data-only` и default-from-org `viewer`): эффективная роль = explicit, не объединение
- `tests/auth/quotas.test.ts`:
  - free-план: проверка лимита на `llm.tokens.monthly`
  - override увеличивает лимит, перезаписывает план
  - истёкший override не учитывается
  - абсолютные лимиты (`projects.max`) считаются по `count(*)`, не по counter-у
- `tests/auth/audit.test.ts` — запись и чтение аудит-лога не теряет данных, индекс по actor работает.
- `tests/auth/strict-account-linking.test.ts`:
  - регистрация по email → попытка логина через Google с тем же email → 409 `conflict.account_email_exists`
  - после явной привязки в настройках Google привязывается к существующему юзеру

### 9.3. Better Auth handler

- `tests/auth/better-auth-handler.test.ts` — `auth.handler` корректно обрабатывает signup → создаёт user/account/session/personal-org/free-subscription в одной транзакции.
- `tests/auth/email-flow.test.ts` — verify token создаётся, по нему `email_verified` ставится в true, токен метится `usedAt`.
- `tests/auth/rate-limit.test.ts`:
  - 6-я попытка `/sign-in/email` за минуту с одного IP — 429 `rate.limited`
  - после паузы > window — снова работает
  - rate limit изолирован по IP (разные IP не блокируют друг друга)

### 9.4. API-роуты

Поднимаем next-server в test-режиме (или вызываем route handlers напрямую с замоканной `headers()`).

- `tests/api/repos.test.ts`:
  - незалогиненный → 401
  - залогиненный без verified email → 423 на POST /api/repos
  - превышение `projects.max` → 402
  - доступ к чужому проекту → 404 (не 403, чтобы не раскрывать существование)
  - создание проекта обычным org-member-ом в team-org: после создания у юзера должна быть `project.edit` permission (через explicit project-owner)
  - понижение org-роли создателя с owner на member: доступ к ранее созданному проекту сохраняется (через explicit project-owner)
- `tests/api/chat-quota.test.ts`:
  - перед запросом `requireQuota` отбивает 402 если квота кончилась
  - после успешного стрима `usage_events` инкрементирует counter
- `tests/api/admin.test.ts` — admin-роуты отбиваются для не-admin'а 403.
- `tests/api/admin-users-update.test.ts`:
  - смена email на свободный — 200, юзер обновлён, сессии инвалидированы
  - смена email на занятый — 409 `conflict.email_exists`
  - не-admin → 403
  - admin без `admin.users.update` (например, `finance`) → 403
  - `email_verified` сбрасывается в false при смене email

### 9.5. e2e через Playwright MCP (как уже принято в форке — ADR-011)

В `verification/scenarios/`:
- `auth-signup-and-create-project.md` — регистрация, verify email через DB-извлечение токена (т.к. SMTP не настроен), создание проекта, вход в чат.
- `auth-strict-link.md` — попытка signin через Google с существующим email → ожидаемая ошибка в UI.

---

## 10. Шаги миграции и деплоя

Текущий форк — single-user, реальных юзеров нет, тестовых данных не жаль. Поэтому миграция = **полное обнуление** БД.

### 10.1. Порядок шагов (для разработчика)

1. **Обновить пакеты**: `npm install --workspace adorable better-auth drizzle-orm postgres @better-auth/drizzle-adapter argon2 uuidv7 zod && npm install -D --workspace adorable drizzle-kit`.
2. **Создать схему**: написать файлы из Раздела 2, прогнать `npm run db:generate` → коммит миграций под `adorable/lib/db/migrations/`.
3. **Настроить env**: добавить в `.env` и `.env.example` секции `GOOGLE_CLIENT_ID/SECRET`, `YANDEX_CLIENT_ID/SECRET`, `VK_CLIENT_ID/SECRET`, `INITIAL_ADMIN_EMAIL`, `INITIAL_ADMIN_PASSWORD`, `EMAIL_FROM` (для отправки verify-писем). Pre-existing `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `DATABASE_URL` оставить.
4. **Накатить**: `npm run db:reset` — применит миграции, посеет роли/permissions/free-план, создаст admin-юзера из env.
5. **Запустить инфру**: `npm run dev:infra:up` (и так уже было в флоу форка).
6. **Запустить next-сервер**: `npm run dev` → `http://localhost:3000` отдаёт страницу логина. Регистрация работает.
7. **Удалить** `adorable/lib/identity-session.ts`, `.adorable/acl.json`, и все импорты `getOrCreateIdentitySession` (есть в `app/api/repos/route.ts`, `app/api/chat/route.ts`, и в `lib/repo-storage.ts` — последний нужно перепрошить так, чтобы он принимал `wrapperRepoId` явным параметром, без cookie-сессии).
8. **Перепрошить ручки** (см. Раздел 8).
9. **Прогнать**: `npm test` — должно остаться 105/105 старых unit + новые (примерно +60 тестов из Раздела 9).
10. **Прогнать e2e** через Playwright MCP по сценариям 9.5.
11. **Обновить документацию**: `FORK_CHANGES.md`, `STATE.md`, `README.md` — упомянуть Better Auth, удаление identity-session, новый порядок setup'а.

### 10.2. Что **не** делается на этом этапе

- UI приёма приглашений (только эндпоинт).
- Реальные платежи.
- Кастомные домены — только структура.
- Telegram/Max OAuth.
- Полноценная админка с UI — только API.
- Smene email юзером.

### 10.3. Сценарий отката

Если после миграции что-то критично не работает: `git revert` коммита миграции, `db:reset`, и форк возвращается в состояние identity-session. Поскольку реальных юзеров нет — ничего не теряем.

---

## 11. Открытые технические вопросы

Эти места я знаю, что нужно решить, но могу решить только в момент имплементации, не сейчас:

1. **Точная версия Better Auth**. На момент написания спеки — `^1.x`. Если в момент имплементации мажор сменится — перечитать секцию `additionalFields`/`accountLinking`/`hooks`, API могло поменяться.
2. **Custom OAuth для Yandex и VK**. Better Auth `genericOAuth`-плагин я предполагаю поддерживает кастомный `mapProfileToUser` — если нет, надо ручной OAuth handler в `/api/auth/callback/{yandex,vk}/route.ts` и руками писать `accounts` через `auth.api.linkAccount`.
3. **VK API v2 (id.vk.com)**. Endpoints приведены под текущий VK ID (v2); если на момент имплементации VK ещё не закроет старый OAuth (`oauth.vk.com`), можно временно использовать его — мобильные либы более стабильные. Решение — в момент.
4. **Email-доставка**. Better Auth требует callback `sendVerificationEmail`. Реализуем через Nodemailer + конфиг SMTP из env (`SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`). В первой версии — синхронная отправка; если будут проблемы с задержками — выносим в job-queue (которой пока нет, можно добавить через BullMQ когда понадобится).
5. **Caddy gateway-проверка для published apps**. Конкретный механизм (`X-Accel-Redirect` vs прокси через next vs Caddy `forward_auth`) выбирается на стадии имплементации. Самый чистый — `Caddy forward_auth` на `/__published_authz/:subdomain`, который возвращает 200/302/403; Caddy на основе ответа либо отдаёт статику, либо редиректит. Это нативно поддерживается Caddy 2 без плагинов.
6. **Cookie-домен для опубликованных приложений**. Better Auth-cookie ставится на `localhost`/`<основной-домен>` без `Domain=` или с явным указанием. Для логики visibility=`authenticated`/`private` нам нужно, чтобы cookie приходил вместе с запросом на `<subdomain>.preview.<домен>`. Решение — выставить `cookieOptions.domain: ".preview.localhost"` (dev) и `.<твой-домен>` (prod). Это требует, чтобы login и preview жили на общем родительском домене. На MVP принимаем, что прод-домен общий; если в будущем preview уедет на отдельный домен — потребуется CSRF-стойкая процедура передачи токена, отдельная задача.
7. **Период билинга для UTC vs TZ юзера**. Используем UTC-первое-число-месяца. Если бизнес попросит TZ-aware — добавим поле `organizations.timezone` и пересчитаем `currentPeriodStartUTC`. Не делаем сейчас.
8. **Rate limit за reverse-proxy.** Better Auth определяет IP из заголовка по умолчанию. За Caddy/nginx нужно настроить `trust proxy` и `X-Forwarded-For`, иначе все запросы будут видеться с одного IP (адреса reverse-proxy) и общий лимит выбьется одним юзером. На MVP — задокументировать в README как требование к развёртыванию: Caddy уже добавляет `X-Forwarded-For`, нужно проверить что Better Auth его читает (или передавать IP через wrapper).

---

## 12. Резюме

Этот документ покрывает **как** реализовать многопользовательскую авторизацию и multi-tenancy в текущем форке Adorable:

- **Auth**: Better Auth поверх Drizzle, строгое слияние аккаунтов, нормализация email, OAuth для Google + generic-провайдеры для Yandex/VK.
- **Schema**: 16 таблиц в Drizzle (users, accounts, sessions, verification_tokens, roles, permissions, role_permissions, organizations, organization_members, admin_role_assignments, projects, project_members, plans, subscriptions, plan_overrides, usage_events, usage_counters, project_tokens, snapshots, invitations, audit_log).
- **Авторизация**: helper-ы `requireSession`, `requirePermission`, `requireAdminPermission`, `getProjectAccessContext`, `requireQuota`, `recordUsage`, `writeAuditLog`. Эффективная роль = роль с большим набором пермишенов из (default-from-org, explicit-project).
- **API**: ~40 эндпоинтов, перечислены поимённо с permission-ами.
- **Интеграция**: удаление `identity-session.ts`, переписывание `/api/repos` и `/api/chat`, сохранение Gitea-wrapper-репо как контейнера для project-метаданных.
- **Тесты**: ~60 новых тестов, разделённых на unit / integration с БД / API-роуты / e2e через Playwright MCP.
- **Миграция**: полный wipe БД, накатка миграций, сидинг — без переноса существующих identity-cookie.

Реализация делается одним большим merge-блоком (auth + schema + integration), потому что отдельно одно от другого работать не может: либо identity-session работает целиком, либо Better Auth работает целиком. Промежуточных состояний не делаем.
