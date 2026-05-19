import { hasDevAuthBypass } from "@/lib/auth-config";
import type { ClearboltClaims, WorkspaceRole } from "@clearbolt/auth";
import { getClearboltAuth, isAuthConfigured } from "@clearbolt/auth/server";
import { V0_WORKSPACE_ID } from "@clearbolt/core";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

const ROLE_RANK: Record<WorkspaceRole, number> = {
  viewer: 0,
  member: 1,
  admin: 2,
  owner: 3,
};

export interface SessionContext {
  claims: ClearboltClaims;
  devBypass: boolean;
}

function devSessionFromEnv(): SessionContext | null {
  const userId = process.env.CLEARBOLT_DEV_USER_ID?.trim();
  const workspaceId =
    process.env.CLEARBOLT_DEV_WORKSPACE_ID?.trim() || V0_WORKSPACE_ID;
  if (!userId) return null;
  const now = Math.floor(Date.now() / 1000);
  return {
    devBypass: true,
    claims: {
      userId,
      workspaceId,
      workspaceRole: "owner",
      iat: now,
      exp: now + 86_400,
    },
  };
}

async function resolveMemberRole(
  _userId: string,
  _organizationId: string,
): Promise<WorkspaceRole> {
  // TODO(V1): auth.api organization member role lookup when typed on better-auth 1.4
  return "member";
}

export async function getSessionContext(): Promise<SessionContext | null> {
  const auth = getClearboltAuth();
  if (auth) {
    const session = await auth.api.getSession({
      headers: await headers(),
    });
    if (session?.user) {
      const activeOrgId = (
        session.session as { activeOrganizationId?: string | null }
      ).activeOrganizationId?.trim();
      const workspaceId =
        activeOrgId ||
        process.env.CLEARBOLT_DEV_WORKSPACE_ID?.trim() ||
        V0_WORKSPACE_ID;
      const role = activeOrgId
        ? await resolveMemberRole(session.user.id, activeOrgId)
        : "owner";
      const now = Math.floor(Date.now() / 1000);
      return {
        devBypass: false,
        claims: {
          userId: session.user.id,
          workspaceId,
          workspaceRole: role,
          iat: now,
          exp: Math.floor(new Date(session.session.expiresAt).getTime() / 1000),
        },
      };
    }
  }

  if (hasDevAuthBypass()) {
    return devSessionFromEnv();
  }

  return null;
}

/** Redirect to sign-in when no session (server components / actions). */
export async function requireSessionOrRedirect(
  nextPath = "/search",
): Promise<SessionContext> {
  const session = await getSessionContext();
  if (!session) {
    redirect(`/sign-in?next=${encodeURIComponent(nextPath)}`);
  }
  return session;
}

export function hasMinRole(
  actual: WorkspaceRole,
  required: WorkspaceRole,
): boolean {
  return ROLE_RANK[actual] >= ROLE_RANK[required];
}

export async function requireSession(): Promise<SessionContext> {
  const session = await getSessionContext();
  if (!session) {
    throw new Error("Sign in required");
  }
  return session;
}
