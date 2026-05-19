export type WorkspaceRole = "owner" | "admin" | "member" | "viewer";

/** Session claims mirrored on CF Workers and Fly (better-auth integration lands in V1+). */
export interface ClearboltClaims {
  userId: string;
  workspaceId: string;
  workspaceRole: WorkspaceRole;
  scopes?: string[];
  iat: number;
  exp: number;
}
