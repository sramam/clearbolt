"use client";

import { authClient, signIn } from "@clearbolt/auth/client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { GoogleLogo } from "@/components/icons/google-logo";
import { Input } from "@/components/ui/input";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

export function SignInForm(props: {
  authEnabled: boolean;
  devBypassAvailable: boolean;
  /** Resend + AUTH_EMAIL_FROM configured (real email delivery). */
  resendOtpConfigured: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/search";
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  /** Stays true after OTP accepted until navigation unmounts the form. */
  const [completingSignIn, setCompletingSignIn] = useState(false);

  const busy = pending || completingSignIn;

  async function onSendCode(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const res = await authClient.emailOtp.sendVerificationOtp({
        email: email.trim(),
        type: "sign-in",
      });
      if (res.error) {
        setError(res.error.message ?? "Could not send code");
        return;
      }
      setCodeSent(true);
    } finally {
      setPending(false);
    }
  }

  async function onVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const res = await signIn.emailOtp({
        email: email.trim(),
        otp: otp.trim(),
      });
      if (res.error) {
        setError(res.error.message ?? "Invalid or expired code");
        setPending(false);
        return;
      }
      setPending(false);
      setCompletingSignIn(true);
      router.push(next);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed");
      setPending(false);
    }
  }

  async function onResendCode() {
    setPending(true);
    setError(null);
    try {
      const res = await authClient.emailOtp.sendVerificationOtp({
        email: email.trim(),
        type: "sign-in",
      });
      if (res.error) {
        setError(res.error.message ?? "Could not resend code");
      }
    } finally {
      setPending(false);
    }
  }

  async function onGoogle() {
    setPending(true);
    setError(null);
    try {
      await signIn.social({ provider: "google", callbackURL: next });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Google sign in failed");
      setPending(false);
    }
  }

  if (!props.authEnabled) {
    return (
      <Card className="mx-auto w-full max-w-md">
        <CardHeader>
          <CardTitle>Auth not configured</CardTitle>
          <CardDescription>
            Set <code className="rounded bg-muted px-1">BETTER_AUTH_SECRET</code>{" "}
            and OAuth keys in repo-root env, or use dev bypass.
          </CardDescription>
        </CardHeader>
        {props.devBypassAvailable ? (
          <CardContent>
            <p className="text-sm text-muted-foreground">
              <code className="rounded bg-muted px-1">
                CLEARBOLT_DEV_USER_ID
              </code>{" "}
              is set — open{" "}
              <a href={next} className="text-primary underline">
                {next}
              </a>{" "}
              to use the app without better-auth.
            </p>
          </CardContent>
        ) : null}
      </Card>
    );
  }

  return (
    <Card className="mx-auto w-full max-w-md">
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
        <CardDescription>
          {props.resendOtpConfigured
            ? "We email you a one-time code. Session uses internal user id, not email."
            : "Dev mode: OTP is printed in the server terminal (set RESEND_API_KEY for real email)."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Button
          type="button"
          variant="outline"
          className="w-full [&_svg]:size-5"
          disabled={busy}
          onClick={() => void onGoogle()}
        >
          <GoogleLogo className="size-5" />
          Sign in with Google
        </Button>
        <div className="relative text-center text-xs text-muted-foreground">
          <span className="bg-card px-2">or email code</span>
        </div>
        {!codeSent ? (
          <form
            onSubmit={(e) => void onSendCode(e)}
            className="flex flex-col gap-3"
          >
            <Input
              type="email"
              name="email"
              placeholder="Email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            {error ? (
              <p className="text-sm text-destructive">{error}</p>
            ) : null}
            <Button type="submit" disabled={busy}>
              {pending ? "Sending…" : "Send sign-in code"}
            </Button>
          </form>
        ) : (
          <form
            onSubmit={(e) => void onVerifyOtp(e)}
            className="flex flex-col gap-3"
          >
            <p className="text-sm text-muted-foreground">
              Code sent to <span className="font-medium">{email}</span>
            </p>
            <Input
              type="text"
              name="otp"
              placeholder="6-digit code"
              autoComplete="one-time-code"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={8}
              value={otp}
              onChange={(e) => setOtp(e.target.value)}
              disabled={busy}
              required
            />
            {error ? (
              <p className="text-sm text-destructive">{error}</p>
            ) : null}
            {completingSignIn ? (
              <p className="text-sm text-muted-foreground" aria-live="polite">
                Code accepted — signing you in…
              </p>
            ) : null}
            <Button type="submit" disabled={busy}>
              {completingSignIn
                ? "Signing you in…"
                : pending
                  ? "Verifying…"
                  : "Sign in"}
            </Button>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => {
                  setCodeSent(false);
                  setOtp("");
                  setError(null);
                  setCompletingSignIn(false);
                }}
              >
                Change email
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => void onResendCode()}
              >
                Resend code
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
