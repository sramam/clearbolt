import { AppShell } from "@/components/app-shell";
import { SignInForm } from "@/components/sign-in-form";
import { getSessionContext } from "@/lib/auth-session";
import { isAuthConfigured, isResendOtpConfigured } from "@clearbolt/auth/server";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

export const metadata: Metadata = {
  title: "Sign in · Clearbolt",
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const session = await getSessionContext();
  const sp = await searchParams;
  const next = sp.next?.trim() || "/search";
  if (session) {
    redirect(next);
  }

  const authEnabled = isAuthConfigured();
  const devBypassAvailable = Boolean(
    !authEnabled && process.env.CLEARBOLT_DEV_USER_ID?.trim(),
  );

  return (
    <AppShell signedIn={false}>
      <Suspense>
        <SignInForm
          authEnabled={authEnabled}
          devBypassAvailable={devBypassAvailable}
          resendOtpConfigured={isResendOtpConfigured()}
        />
      </Suspense>
    </AppShell>
  );
}
