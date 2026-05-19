import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { emailOTP, organization } from "better-auth/plugins";
import { sendClearboltVerificationOtp } from "./send-verification-otp-email.js";

function optionalSocial(
  clientId: string | undefined,
  clientSecret: string | undefined,
): { clientId: string; clientSecret: string } | undefined {
  if (!clientId?.trim() || !clientSecret?.trim()) return undefined;
  return { clientId: clientId.trim(), clientSecret: clientSecret.trim() };
}

/** Prisma client from `@clearbolt/storage-neon` (`getPrisma`). */
export function createClearboltAuth(
  prisma: Parameters<typeof prismaAdapter>[0],
) {
  const secret = process.env.BETTER_AUTH_SECRET?.trim();
  if (!secret || secret.length < 32) {
    throw new Error(
      "BETTER_AUTH_SECRET must be set (≥32 chars). Generate: openssl rand -base64 32",
    );
  }

  const google = optionalSocial(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
  );
  const github = optionalSocial(
    process.env.GITHUB_CLIENT_ID,
    process.env.GITHUB_CLIENT_SECRET,
  );

  const socialProviders: Record<
    string,
    { clientId: string; clientSecret: string }
  > = {};
  if (google) socialProviders.google = google;
  if (github) socialProviders.github = github;

  return betterAuth({
    database: prismaAdapter(prisma, { provider: "postgresql" }),
    secret,
    baseURL: process.env.BETTER_AUTH_URL?.trim() || "http://localhost:3000",
    ...(Object.keys(socialProviders).length > 0 ? { socialProviders } : {}),
    plugins: [
      organization({
        allowUserToCreateOrganization: true,
      }),
      emailOTP({
        async sendVerificationOTP({ email, otp, type }) {
          sendClearboltVerificationOtp({ email, otp, type });
        },
      }),
    ],
  });
}
