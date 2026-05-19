import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isResendOtpConfigured,
  sendClearboltVerificationOtp,
} from "../src/server/send-verification-otp-email.js";

describe("sendClearboltVerificationOtp", () => {
  const env = process.env;

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
  });

  afterEach(() => {
    process.env = env;
    vi.unstubAllGlobals();
  });

  it("isResendOtpConfigured when Resend env is present", () => {
    process.env.RESEND_API_KEY = "re_test";
    process.env.AUTH_EMAIL_FROM = "noreply@example.com";
    expect(isResendOtpConfigured()).toBe(true);
  });

  it("logs OTP in dev when Resend is not configured", () => {
    delete process.env.RESEND_API_KEY;
    delete process.env.AUTH_EMAIL_FROM;
    process.env.NODE_ENV = "development";
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    sendClearboltVerificationOtp({
      email: "a@b.co",
      otp: "123456",
      type: "sign-in",
    });
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("123456"),
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("calls Resend API when configured", () => {
    process.env.RESEND_API_KEY = "re_test";
    process.env.AUTH_EMAIL_FROM = "Clearbolt <noreply@example.com>";
    process.env.NODE_ENV = "production";
    sendClearboltVerificationOtp({
      email: "a@b.co",
      otp: "654321",
      type: "sign-in",
    });
    expect(fetch).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer re_test",
        }),
      }),
    );
    const body = JSON.parse(
      /** @type {RequestInit} */ (vi.mocked(fetch).mock.calls[0]?.[1]).body,
    );
    expect(body.html).toContain("<!DOCTYPE html>");
    expect(body.text).toContain("654321");
  });
});
