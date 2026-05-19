import { afterEach, describe, expect, it, vi } from "vitest";
import {
  proxySessionGeneration,
  proxySessionKeyForWorker,
  proxySessionRotateWindowMs,
} from "../src/proxy-session-rotate.js";

describe("proxy session rotation", () => {
  const prev = { ...process.env };

  afterEach(() => {
    process.env = { ...prev };
    vi.unstubAllEnvs();
  });

  it("bumps generation when window elapses", () => {
    vi.stubEnv("CLEARBOLT_PROXY_SESSION_DURATION_MINUTES", "10");
    vi.stubEnv("CLEARBOLT_PROXY_SESSION_ROTATE_BUFFER_MS", "0");
    const window = proxySessionRotateWindowMs();
    expect(proxySessionGeneration(0)).toBe(0);
    expect(proxySessionGeneration(window - 1)).toBe(0);
    expect(proxySessionGeneration(window)).toBe(1);
  });

  it("embeds worker and generation in session key", () => {
    vi.stubEnv("CLEARBOLT_PROXY_SESSION_ID", "catalog");
    expect(proxySessionKeyForWorker(3, 7)).toBe("catalog-w3-g7");
  });

  it("supports 2-minute Decodo stickies with pre-expiry rotation", () => {
    vi.stubEnv("CLEARBOLT_PROXY_SESSION_DURATION_MINUTES", "2");
    vi.stubEnv("CLEARBOLT_PROXY_SESSION_ROTATE_BUFFER_MS", "30000");
    expect(proxySessionRotateWindowMs()).toBe(90_000);
  });
});
