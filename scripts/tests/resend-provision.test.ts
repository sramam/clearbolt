import { describe, expect, it } from "vitest";
import {
  defaultAuthEmailFrom,
  resendApiKeyName,
} from "../lib/resend-provision.mjs";

describe("resend-provision", () => {
  it("names API keys per environment", () => {
    expect(resendApiKeyName("dev")).toBe("clearbolt-dev");
    expect(resendApiKeyName("prod")).toBe("clearbolt-prod");
  });

  it("defaults dev sender to Resend onboarding address", () => {
    expect(defaultAuthEmailFrom("dev", {})).toBe(
      "Clearbolt <onboarding@resend.dev>",
    );
  });

  it("prefers AUTH_EMAIL_FROM override", () => {
    expect(
      defaultAuthEmailFrom("prod", {
        AUTH_EMAIL_FROM: "App <hello@example.com>",
      }),
    ).toBe("App <hello@example.com>");
  });

  it("builds prod from domain when set", () => {
    expect(
      defaultAuthEmailFrom("prod", { RESEND_FROM_DOMAIN: "mail.example.com" }),
    ).toBe("Clearbolt <noreply@mail.example.com>");
  });
});
