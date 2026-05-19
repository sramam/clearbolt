"use client";

import { Button } from "@/components/ui/button";
import { signOut } from "@clearbolt/auth/client";
import Link from "next/link";
import { useRouter } from "next/navigation";

export function HeaderAuth(props: {
  signedIn: boolean;
  userLabel?: string;
  devBypass?: boolean;
}) {
  const router = useRouter();

  if (!props.signedIn) {
    return (
      <Button variant="outline" size="sm" className="ml-auto" asChild>
        <Link href="/sign-in">Sign in</Link>
      </Button>
    );
  }

  return (
    <div className="ml-auto flex items-center gap-2">
      <span className="hidden text-xs text-muted-foreground sm:inline">
        {props.userLabel}
        {props.devBypass ? " (dev)" : ""}
      </span>
      {!props.devBypass ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={async () => {
            await signOut();
            router.push("/sign-in");
            router.refresh();
          }}
        >
          Sign out
        </Button>
      ) : null}
    </div>
  );
}
