"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

type Member = {
  userId: string;
  email: string | null;
  name: string | null;
  role: string;
  joinedAt: string;
};

const ROLES = ["owner", "admin", "member"];

export function OrgMembersClient({
  orgId,
  initialMembers,
  currentUserId,
  canManage,
}: {
  orgId: string;
  initialMembers: Member[];
  currentUserId: string;
  canManage: boolean;
}) {
  const [members, setMembers] = useState(initialMembers);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showStub, setShowStub] = useState(false);

  const updateRole = async (userId: string, role: string) => {
    setBusyId(userId);
    setError(null);
    try {
      const res = await fetch(`/api/orgs/${orgId}/members/${userId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        throw new Error(err?.error?.message ?? `HTTP ${res.status}`);
      }
      setMembers((rows) =>
        rows.map((r) => (r.userId === userId ? { ...r, role } : r)),
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const removeMember = async (userId: string) => {
    if (!window.confirm("Удалить участника из организации?")) return;
    setBusyId(userId);
    setError(null);
    try {
      const res = await fetch(`/api/orgs/${orgId}/members/${userId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        throw new Error(err?.error?.message ?? `HTTP ${res.status}`);
      }
      setMembers((rows) => rows.filter((r) => r.userId !== userId));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <Button type="button" variant="outline" onClick={() => setShowStub(true)}>
          + Добавить участника
        </Button>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="overflow-hidden rounded-md border border-border/40">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Имя / email</th>
              <th className="px-3 py-2">Роль</th>
              <th className="px-3 py-2 text-right"></th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.userId} className="border-t border-border/40">
                <td className="px-3 py-2">
                  <div className="font-medium">{m.name ?? m.email ?? "—"}</div>
                  {m.name && m.email ? (
                    <div className="text-xs text-muted-foreground">
                      {m.email}
                    </div>
                  ) : null}
                </td>
                <td className="px-3 py-2">
                  {canManage && m.userId !== currentUserId ? (
                    <select
                      className="rounded border bg-background px-2 py-1 text-sm"
                      value={m.role}
                      disabled={busyId === m.userId}
                      onChange={(e) => updateRole(m.userId, e.target.value)}
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="rounded bg-muted px-2 py-0.5 text-xs uppercase">
                      {m.role}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  {canManage && m.userId !== currentUserId ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busyId === m.userId}
                      onClick={() => removeMember(m.userId)}
                    >
                      Удалить
                    </Button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showStub ? (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4"
        >
          <div className="w-full max-w-md rounded-md border bg-card p-5 shadow-md">
            <h2 className="mb-2 text-base font-semibold">
              Приглашения скоро появятся
            </h2>
            <p className="mb-4 text-sm text-muted-foreground">
              В этой версии участников добавляет администратор. Email-приглашения
              будут в следующем релизе.
            </p>
            <div className="flex justify-end">
              <Button type="button" onClick={() => setShowStub(false)}>
                Понятно
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
