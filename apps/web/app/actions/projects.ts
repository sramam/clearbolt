"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSessionOrRedirect } from "@/lib/auth-session";
import { createMetadataStore } from "@/lib/metadata-store";

export async function promoteDealToProject(formData: FormData) {
  const session = await requireSessionOrRedirect("/search");

  const canonicalDealId = String(formData.get("canonicalDealId") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim() || "Untitled deal";
  if (!canonicalDealId) {
    throw new Error("canonicalDealId is required");
  }

  const store = createMetadataStore();
  if (!store) {
    throw new Error("DATABASE_URL is not configured");
  }

  try {
    const project = await store.promoteCanonicalToProject({
      workspaceId: session.claims.workspaceId,
      createdByUserId: session.claims.userId,
      canonicalDealId,
      title,
      addToDealbox: true,
    });
    revalidatePath("/projects");
    revalidatePath("/search");
    redirect(`/projects?highlight=${project.id}`);
  } finally {
    await store.disconnect();
  }
}
