import { describe, expect, it } from "vitest";
import { buildOtpEmailContent } from "../src/server/otp-email-template.js";

describe("buildOtpEmailContent", () => {
  it("includes OTP in html and plain text", () => {
    const { subject, html, text } = buildOtpEmailContent({
      otp: "482910",
      type: "sign-in",
    });
    expect(subject).toContain("sign-in");
    expect(html).toContain("482910");
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("Sign in to Clearbolt");
    expect(text).toContain("482910");
    expect(text).toContain("Sign in to Clearbolt");
  });

  it("escapes html in otp", () => {
    const { html } = buildOtpEmailContent({
      otp: "<script>",
      type: "sign-in",
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
