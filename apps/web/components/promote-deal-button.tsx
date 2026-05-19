"use client";

import { Button } from "@/components/ui/button";
import { FolderPlus } from "lucide-react";
import { useFormStatus } from "react-dom";
import { promoteDealToProject } from "@/app/actions/projects";

function SubmitLabel() {
  const { pending } = useFormStatus();
  return pending ? "Promoting…" : "Promote to project";
}

export function PromoteDealButton(props: {
  canonicalDealId: string;
  title: string | null;
  signedIn: boolean;
}) {
  if (!props.signedIn) {
    return (
      <Button variant="outline" size="sm" asChild>
        <a href="/sign-in?next=/search">Sign in to promote</a>
      </Button>
    );
  }

  return (
    <form action={promoteDealToProject}>
      <input type="hidden" name="canonicalDealId" value={props.canonicalDealId} />
      <input
        type="hidden"
        name="title"
        value={props.title?.trim() || "Untitled listing"}
      />
      <Button type="submit" variant="outline" size="sm">
        <FolderPlus className="mr-1.5 size-4" />
        <SubmitLabel />
      </Button>
    </form>
  );
}
