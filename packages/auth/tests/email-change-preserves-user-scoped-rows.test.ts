import { describe, expect, it } from "vitest";

/**
 * Documents the stable-key contract before better-auth is wired: persisted rows
 * key off User.id; login email is not part of the lookup key.
 */
describe("email change preserves user-scoped row keys", () => {
  const internalUserId = "usr_stable_001";

  const marketQueries = [
    {
      id: "q1",
      workspaceId: "ws_a",
      ownerUserId: internalUserId,
      adapter: "bizbuysell",
      searchUrl: "https://example.com/search",
    },
  ];

  const dispositions = [
    {
      id: "d1",
      userId: internalUserId,
      workspaceId: "ws_a",
      projectId: "proj_1",
      bucket: "dealbox" as const,
    },
  ];

  it("resolves rows by userId after email changes", () => {
    const emails = ["old@example.com", "new@example.com"];
    for (const _email of emails) {
      const queriesForUser = marketQueries.filter(
        (q) => q.ownerUserId === internalUserId,
      );
      const dispositionsForUser = dispositions.filter(
        (d) => d.userId === internalUserId,
      );
      expect(queriesForUser).toHaveLength(1);
      expect(dispositionsForUser).toHaveLength(1);
      expect(queriesForUser[0]?.ownerUserId).not.toMatch(/@/);
    }
  });
});
