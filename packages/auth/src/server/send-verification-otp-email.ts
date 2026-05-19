import {
  buildOtpEmailContent,
  type VerificationOtpType,
} from "./otp-email-template.js";

export type { VerificationOtpType };

/** True when Resend can send OTP mail (production path). */
export function isResendOtpConfigured(): boolean {
  return Boolean(
    process.env.RESEND_API_KEY?.trim() &&
      process.env.AUTH_EMAIL_FROM?.trim(),
  );
}

/**
 * Sends OTP via Resend REST API. In dev without keys, logs to stdout unless
 * `CLEARBOLT_AUTH_OTP_CONSOLE=false`.
 */
export function sendClearboltVerificationOtp(params: {
  email: string;
  otp: string;
  type: VerificationOtpType;
}): void {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.AUTH_EMAIL_FROM?.trim();

  if (!apiKey || !from) {
    const logToConsole =
      process.env.NODE_ENV !== "production" &&
      process.env.CLEARBOLT_AUTH_OTP_CONSOLE !== "false";
    if (logToConsole) {
      console.info(
        `[clearbolt-auth-otp] ${params.type} → ${params.email}: ${params.otp}`,
      );
      return;
    }
    throw new Error(
      "RESEND_API_KEY and AUTH_EMAIL_FROM must be set to send OTP emails",
    );
  }

  const { subject, html, text } = buildOtpEmailContent({
    otp: params.otp,
    type: params.type,
  });

  void fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [params.email],
      subject,
      html,
      text,
    }),
  }).then(async (res) => {
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(
        `[clearbolt-auth-otp] Resend ${res.status}: ${body.slice(0, 500)}`,
      );
    }
  });
}
