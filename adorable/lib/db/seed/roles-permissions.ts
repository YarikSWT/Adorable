// System roles + permissions seed.
//
// Wildcards (e.g. "project.*") are expanded at seed time against the real
// permission slugs. Runtime checks always operate on concrete slugs — this
// keeps the audit log readable and avoids implicit grants creeping in later.

import { eq } from "drizzle-orm";
import { db } from "../client";
import { permissions, rolePermissions, roles } from "../schema/roles";

export const SYSTEM_PERMISSIONS = [
  // project scope
  { slug: "project.view",                 scopeHint: "project",      name: "Просмотр проекта" },
  { slug: "project.edit",                 scopeHint: "project",      name: "Редактирование кода и чата" },
  { slug: "project.publish",              scopeHint: "project",      name: "Деплой и публикация" },
  { slug: "project.tokens.manage",        scopeHint: "project",      name: "Управление API-токенами" },
  { slug: "project.members.manage",       scopeHint: "project",      name: "Управление участниками" },
  { slug: "project.delete",               scopeHint: "project",      name: "Удаление проекта" },
  { slug: "project.data.manage",          scopeHint: "project",      name: "Управление данными приложения" },
  { slug: "project.schema.manage",        scopeHint: "project",      name: "Управление схемой данных" },
  { slug: "project.functions.manage",     scopeHint: "project",      name: "Управление функциями приложения" },
  { slug: "project.logs.view",            scopeHint: "project",      name: "Просмотр логов приложения" },
  { slug: "project.domain.manage",        scopeHint: "project",      name: "Кастомный домен" },
  // organization scope
  { slug: "organization.view",            scopeHint: "organization", name: "Просмотр организации" },
  { slug: "organization.update",          scopeHint: "organization", name: "Редактирование организации" },
  { slug: "organization.members.manage",  scopeHint: "organization", name: "Управление участниками org" },
  { slug: "organization.billing.view",    scopeHint: "organization", name: "Просмотр биллинга" },
  { slug: "organization.delete",          scopeHint: "organization", name: "Удаление организации" },
  { slug: "organization.projects.create", scopeHint: "organization", name: "Создание проектов" },
  // admin scope
  { slug: "admin.users.read",             scopeHint: "admin",        name: "Список юзеров" },
  { slug: "admin.users.update",           scopeHint: "admin",        name: "Редактирование юзера" },
  { slug: "admin.users.ban",              scopeHint: "admin",        name: "Бан/разбан" },
  { slug: "admin.users.delete",           scopeHint: "admin",        name: "Удаление юзера" },
  { slug: "admin.organizations.read",     scopeHint: "admin",        name: "Список организаций" },
  { slug: "admin.plans.read",             scopeHint: "admin",        name: "Просмотр планов" },
  { slug: "admin.plans.update",           scopeHint: "admin",        name: "Редактирование планов" },
  { slug: "admin.plan_overrides.manage",  scopeHint: "admin",        name: "Override-ы лимитов" },
  { slug: "admin.subscriptions.manage",   scopeHint: "admin",        name: "Подписки" },
  { slug: "admin.audit.read",             scopeHint: "admin",        name: "Аудит-лог" },
  { slug: "admin.roles.manage",           scopeHint: "admin",        name: "Выдача админ-ролей" },
] as const;

type RoleScope = "organization" | "project" | "admin";

type SystemRoleDef = {
  scope: RoleScope;
  slug: string;
  defaultProjectRole?: string;
  perms: readonly string[];
};

export const SYSTEM_ROLES: readonly SystemRoleDef[] = [
  { scope: "organization", slug: "owner",  defaultProjectRole: "owner",     perms: ["organization.*", "project.view"] },
  { scope: "organization", slug: "admin",  defaultProjectRole: "publisher", perms: ["organization.view", "organization.update", "organization.members.manage", "organization.billing.view", "organization.projects.create"] },
  { scope: "organization", slug: "member", defaultProjectRole: "viewer",    perms: ["organization.view", "organization.projects.create"] },

  { scope: "project", slug: "viewer",    perms: ["project.view"] },
  { scope: "project", slug: "editor",    perms: ["project.view", "project.edit", "project.data.manage", "project.logs.view"] },
  { scope: "project", slug: "publisher", perms: ["project.view", "project.edit", "project.publish", "project.data.manage", "project.schema.manage", "project.functions.manage", "project.logs.view", "project.tokens.manage", "project.domain.manage"] },
  { scope: "project", slug: "owner",     perms: ["project.*"] },

  { scope: "admin", slug: "superadmin", perms: ["admin.*"] },
  { scope: "admin", slug: "support",    perms: ["admin.users.read", "admin.users.update", "admin.organizations.read", "admin.plans.read", "admin.audit.read"] },
  { scope: "admin", slug: "finance",    perms: ["admin.users.read", "admin.organizations.read", "admin.plans.*", "admin.plan_overrides.manage", "admin.subscriptions.manage"] },
  { scope: "admin", slug: "content",    perms: [] },
] as const;

const ROLE_NAMES: Record<string, string> = {
  "organization.owner": "Владелец организации",
  "organization.admin": "Администратор организации",
  "organization.member": "Участник организации",
  "project.viewer": "Зритель проекта",
  "project.editor": "Редактор проекта",
  "project.publisher": "Публикатор проекта",
  "project.owner": "Владелец проекта",
  "admin.superadmin": "Суперадмин",
  "admin.support": "Саппорт",
  "admin.finance": "Финансы",
  "admin.content": "Модерация контента",
};

const expandWildcards = (
  patterns: readonly string[],
  allSlugs: readonly string[],
): string[] => {
  const out = new Set<string>();
  for (const pat of patterns) {
    if (pat.endsWith(".*")) {
      const prefix = pat.slice(0, -1); // keep trailing dot
      for (const slug of allSlugs) {
        if (slug.startsWith(prefix)) out.add(slug);
      }
    } else {
      out.add(pat);
    }
  }
  return [...out];
};

export const seedRolesPermissions = async (): Promise<void> => {
  // 1. permissions
  await db
    .insert(permissions)
    .values(SYSTEM_PERMISSIONS.map((p) => ({ ...p })))
    .onConflictDoNothing({ target: permissions.slug });

  const allPerms = await db
    .select({ id: permissions.id, slug: permissions.slug })
    .from(permissions);
  const slugToId = new Map(allPerms.map((p) => [p.slug, p.id]));
  const allSlugs = allPerms.map((p) => p.slug);

  // 2. roles — first pass without defaultProjectRoleId so org-roles can later
  //    reference the project-roles we insert below.
  for (const def of SYSTEM_ROLES) {
    await db
      .insert(roles)
      .values({
        scope: def.scope,
        slug: def.slug,
        name: ROLE_NAMES[`${def.scope}.${def.slug}`] ?? def.slug,
        isSystem: true,
      })
      .onConflictDoNothing({ target: [roles.scope, roles.slug] });
  }

  // 3. wire defaultProjectRoleId for organization roles that have one
  const allRoles = await db
    .select({ id: roles.id, scope: roles.scope, slug: roles.slug })
    .from(roles);
  const roleByKey = new Map(
    allRoles.map((r) => [`${r.scope}.${r.slug}`, r.id]),
  );

  for (const def of SYSTEM_ROLES) {
    if (def.scope !== "organization" || !def.defaultProjectRole) continue;
    const orgRoleId = roleByKey.get(`organization.${def.slug}`);
    const projectRoleId = roleByKey.get(`project.${def.defaultProjectRole}`);
    if (!orgRoleId || !projectRoleId) continue;
    await db
      .update(roles)
      .set({ defaultProjectRoleId: projectRoleId })
      .where(eq(roles.id, orgRoleId));
  }

  // 4. role_permissions — expand wildcards against the actual slug set
  for (const def of SYSTEM_ROLES) {
    const roleId = roleByKey.get(`${def.scope}.${def.slug}`);
    if (!roleId) continue;
    const expanded = expandWildcards(def.perms, allSlugs);
    if (expanded.length === 0) continue;
    const rows = expanded
      .map((slug) => slugToId.get(slug))
      .filter((id): id is string => Boolean(id))
      .map((permissionId) => ({ roleId, permissionId }));
    if (rows.length === 0) continue;
    await db.insert(rolePermissions).values(rows).onConflictDoNothing();
  }
};
