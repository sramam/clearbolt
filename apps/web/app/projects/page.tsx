import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireSessionOrRedirect } from "@/lib/auth-session";
import { createMetadataStore } from "@/lib/metadata-store";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Projects · Clearbolt",
};

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ highlight?: string }>;
}) {
  const session = await requireSessionOrRedirect("/projects");

  const sp = await searchParams;
  const highlight = sp.highlight?.trim();

  const store = createMetadataStore();
  const projects =
    store != null
      ? await store.listWorkspaceProjects(session.claims.workspaceId)
      : [];

  if (store) await store.disconnect();

  return (
    <AppShell
      signedIn
      userLabel={session.claims.userId.slice(0, 12)}
      devBypass={session.devBypass}
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Team pipeline deals you have promoted from search. Deep research runs
            when status is researching.
          </p>
        </div>

        {projects.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>No projects yet</CardTitle>
              <CardDescription>
                Promote a listing from{" "}
                <Link href="/search" className="text-primary underline">
                  Search
                </Link>{" "}
                to start diligence.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <ul className="flex list-none flex-col gap-3 p-0">
            {projects.map((p) => (
              <li key={p.id}>
                <Card
                  className={
                    highlight === p.id ? "ring-2 ring-primary" : undefined
                  }
                >
                  <CardHeader>
                    <div className="flex flex-wrap items-center gap-2">
                      <CardTitle className="text-lg">{p.title}</CardTitle>
                      <Badge variant="secondary">{p.status}</Badge>
                    </div>
                    <CardDescription className="font-mono text-xs">
                      {p.id}
                      {p.canonicalDealId
                        ? ` · canonical ${p.canonicalDealId}`
                        : ""}
                    </CardDescription>
                  </CardHeader>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </div>
    </AppShell>
  );
}
