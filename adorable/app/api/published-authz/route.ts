// Caddy forward_auth backend for published preview subdomains.
//
// Spec sketch (Doc 2 §7.8) called this `/__published_authz`; Next.js
// route handlers refuse double-underscore-prefixed folders, so the actual
// path is `/api/published-authz`.
//
// Wiring (Caddyfile sketch — see
// verification/scenarios/publication-visibility.md):
//
//   *.preview.<domain> {
//     forward_auth next-server:3000 {
//       uri /api/published-authz?subdomain={labels.3}
//       copy_headers Cookie
//     }
//     reverse_proxy <static or sandbox upstream>
//   }
//
// Contract per Doc 2 §7.8 + Правка 2:
//   - public         → 200 (no body)
//   - authenticated  → 200 if session && emailVerified, else 401
//   - private        → 200 if session && emailVerified && project membership, else 401 / 403
//   - no published-snapshot or unknown subdomain → 404
//
// Caddy translates 401 → /login redirect, 403 → 403, 200 → passthrough to
// the upstream. Body must stay empty so Caddy doesn't accidentally relay it.

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { projects } from "@/lib/db/schema/projects";
import { getRequestSession } from "@/lib/auth/session";
import { getProjectAccessContext } from "@/lib/auth/authorization";

const empty = (status: number): Response =>
  new NextResponse(null, { status });

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  // Caddy passes the subdomain via either query (?subdomain=) or via the
  // X-Subdomain header — accept both.
  const subdomain =
    url.searchParams.get("subdomain") ??
    req.headers.get("x-subdomain") ??
    null;
  if (!subdomain) return empty(400);

  const rows = await db
    .select({
      id: projects.id,
      organizationId: projects.organizationId,
      publishedVisibility: projects.publishedVisibility,
      publishedSnapshotId: projects.publishedSnapshotId,
    })
    .from(projects)
    .where(eq(projects.previewSubdomain, subdomain))
    .limit(1);
  const project = rows[0];
  if (!project || !project.publishedSnapshotId) {
    return empty(404);
  }

  const visibility = project.publishedVisibility;
  if (visibility === "public") return empty(200);

  const session = await getRequestSession();
  if (!session) return empty(401);
  if (!session.user.emailVerified) return empty(401);

  if (visibility === "authenticated") return empty(200);
  if (visibility === "private") {
    const access = await getProjectAccessContext(session.user.id, project.id);
    return access ? empty(200) : empty(403);
  }
  // Defensive: unknown / null visibility — treat as private no-access.
  return empty(403);
}
