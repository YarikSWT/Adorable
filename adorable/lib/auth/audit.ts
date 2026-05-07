// Append-only audit log for sensitive operations.
//
// Failure-mode: NEVER throws. The original request must succeed even if
// audit insertion blows up — we just log to stderr so the failure is visible
// in operations. This trade-off comes from spec §5.5: "не падает наружу,
// ошибки в stderr".
//
// IDs are UUID v7 so the table sorts chronologically without an extra index
// on created_at.

import { uuidv7 } from "uuidv7";
import { db as defaultDb } from "@/lib/db/client";
import { auditLog } from "@/lib/db/schema/audit";

type DbOrTx = typeof defaultDb;

export type AuditEntry = {
  actorUserId?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  organizationId?: string | null;
  metadata?: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
};

export const writeAuditLog = async (
  entry: AuditEntry,
  database: DbOrTx = defaultDb,
): Promise<void> => {
  try {
    await database.insert(auditLog).values({
      id: uuidv7(),
      actorUserId: entry.actorUserId ?? null,
      action: entry.action,
      targetType: entry.targetType ?? null,
      targetId: entry.targetId ?? null,
      organizationId: entry.organizationId ?? null,
      metadata: (entry.metadata as object | undefined) ?? null,
      ipAddress: entry.ipAddress ?? null,
      userAgent: entry.userAgent ?? null,
    });
  } catch (err) {
    console.error("[audit] write failed", { action: entry.action, err });
  }
};
