export type VerificationOtpType =
  | "sign-in"
  | "email-verification"
  | "forget-password";

const SUBJECTS: Record<VerificationOtpType, string> = {
  "sign-in": "Your Clearbolt sign-in code",
  "email-verification": "Verify your Clearbolt email",
  "forget-password": "Reset your Clearbolt password",
};

const HEADLINES: Record<VerificationOtpType, string> = {
  "sign-in": "Sign in to Clearbolt",
  "email-verification": "Verify your email",
  "forget-password": "Reset your password",
};

const LEAD: Record<VerificationOtpType, string> = {
  "sign-in": "Use this one-time code to finish signing in. It expires in 5 minutes.",
  "email-verification":
    "Enter this code to verify your email address. It expires in 5 minutes.",
  "forget-password":
    "Enter this code to reset your password. It expires in 5 minutes.",
};

/** Escapes text for HTML email bodies. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildOtpEmailContent(params: {
  otp: string;
  type: VerificationOtpType;
}): { subject: string; html: string; text: string } {
  const otp = params.otp.trim();
  const subject = SUBJECTS[params.type];
  const headline = HEADLINES[params.type];
  const lead = LEAD[params.type];
  const safeOtp = escapeHtml(otp);

  const text = [
    headline,
    "",
    lead,
    "",
    otp,
    "",
    "If you did not request this email, you can ignore it.",
    "",
    "— Clearbolt",
  ].join("\n");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#f4f4f5;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:440px;background-color:#ffffff;border:1px solid #e4e4e7;border-radius:12px;overflow:hidden;">
          <tr>
            <td style="padding:28px 32px 8px 32px;">
              <p style="margin:0 0 8px 0;font-size:13px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:#71717a;">Clearbolt</p>
              <h1 style="margin:0;font-size:22px;font-weight:600;line-height:1.3;color:#18181b;">${escapeHtml(headline)}</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 32px 24px 32px;">
              <p style="margin:0;font-size:15px;line-height:1.6;color:#52525b;">${escapeHtml(lead)}</p>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:0 32px 28px 32px;">
              <table role="presentation" cellspacing="0" cellpadding="0" style="background-color:#fafafa;border:1px solid #e4e4e7;border-radius:10px;">
                <tr>
                  <td style="padding:20px 32px;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,'Liberation Mono','Courier New',monospace;font-size:32px;font-weight:700;letter-spacing:0.35em;color:#18181b;">
                    ${safeOtp}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 28px 32px;border-top:1px solid #f4f4f5;">
              <p style="margin:20px 0 0 0;font-size:13px;line-height:1.5;color:#a1a1aa;">
                If you did not request this email, you can safely ignore it. Someone may have entered your address by mistake.
              </p>
            </td>
          </tr>
        </table>
        <p style="margin:16px 0 0 0;font-size:12px;color:#a1a1aa;">Clearbolt · acquisition search</p>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject, html, text };
}
