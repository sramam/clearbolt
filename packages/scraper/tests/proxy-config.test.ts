import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import {
  canEscalateHostToResidential,
  clearProxyHostEscalations,
  markHostUseResidential,
  proxyDispatcherUrl,
  proxyTierForHost,
  readProxyPolicy,
  resolveProxyEndpoint,
} from "../src/proxy-config.js";
import {
  clearProxyEndpointsFileCache,
  pickProxyEndpointFromList,
} from "../src/proxy-endpoints-file.js";

describe("proxy-config", () => {
  const env = process.env;

  beforeEach(() => {
    clearProxyEndpointsFileCache();
    delete process.env.CLEARBOLT_PROXY_ENDPOINTS_FILE;
    delete process.env.CLEARBOLT_PROXY_USERNAME_STYLE;
    delete process.env.CLEARBOLT_PROXY_SESSION_DURATION_MINUTES;
    delete process.env.CLEARBOLT_PROXY_SESSION_ID;
    delete process.env.CLEARBOLT_PROXY_COUNTRY;
    delete process.env.CLEARBOLT_PROXY_RESIDENTIAL;
    delete process.env.CLEARBOLT_PROXY_DATACENTER;
    delete process.env.CLEARBOLT_PROXY_POLICY;
    clearProxyHostEscalations();
  });

  afterEach(() => {
    process.env = env;
    clearProxyHostEscalations();
  });

  it("parse datacenter URL with credentials", () => {
    process.env.CLEARBOLT_PROXY_DATACENTER =
      "http://customer-user:secret@pr.oxylabs.io:7777";
    const ep = resolveProxyEndpoint("datacenter");
    expect(ep?.server).toBe("http://pr.oxylabs.io:7777");
    expect(ep?.username).toBe("customer-user");
    expect(ep?.password).toBe("secret");
    expect(proxyDispatcherUrl("datacenter")).toContain("customer-user");
  });

  it("datacenter-first escalates host to residential", () => {
    process.env.CLEARBOLT_PROXY_POLICY = "datacenter-first";
    process.env.CLEARBOLT_PROXY_DATACENTER = "http://u:p@dc.example:8080";
    process.env.CLEARBOLT_PROXY_RESIDENTIAL =
      "http://u:p@res.example:8080";
    expect(proxyTierForHost("bizbuysell.com")).toBe("datacenter");
    markHostUseResidential("bizbuysell.com");
    expect(proxyTierForHost("bizbuysell.com")).toBe("residential");
  });

  it("defaults policy to direct", () => {
    delete process.env.CLEARBOLT_PROXY_POLICY;
    expect(readProxyPolicy()).toBe("direct");
  });

  it("direct-then-residential starts direct and escalates on mark", () => {
    process.env.CLEARBOLT_PROXY_POLICY = "direct-then-residential";
    process.env.CLEARBOLT_PROXY_RESIDENTIAL =
      "http://u:p@res.example:8080";
    delete process.env.CLEARBOLT_PROXY_DATACENTER;
    expect(proxyTierForHost("bizbuysell.com")).toBe("direct");
    markHostUseResidential("bizbuysell.com");
    expect(proxyTierForHost("bizbuysell.com")).toBe("residential");
    expect(canEscalateHostToResidential("bizbuysell.com")).toBe(true);
  });

  it("appends country suffix to proxy username", () => {
    process.env.CLEARBOLT_PROXY_RESIDENTIAL =
      "http://customer-user:secret@gate.example:7777";
    process.env.CLEARBOLT_PROXY_COUNTRY = "us";
    const ep = resolveProxyEndpoint("residential");
    expect(ep?.username).toBe("customer-user_country-us");
  });

  it("builds decodo sticky username with 10 minute session", () => {
    process.env.CLEARBOLT_PROXY_RESIDENTIAL =
      "http://spnpt7lvn9:secret@gate.decodo.com:10001";
    process.env.CLEARBOLT_PROXY_USERNAME_STYLE = "decodo";
    process.env.CLEARBOLT_PROXY_COUNTRY = "us";
    process.env.CLEARBOLT_PROXY_SESSION_DURATION_MINUTES = "10";
    process.env.CLEARBOLT_PROXY_SESSION_ID = "catalog-a";
    const ep = resolveProxyEndpoint("residential");
    expect(ep?.server).toBe("http://gate.decodo.com:10001");
    expect(ep?.username).toBe(
      "user-spnpt7lvn9-country-us-session-catalog-a-sessionduration-10",
    );
  });

  it("normalizes https gate URL to http proxy server", () => {
    process.env.CLEARBOLT_PROXY_RESIDENTIAL =
      "https://u:p@gate.decodo.com:10001";
    const ep = resolveProxyEndpoint("residential");
    expect(ep?.server).toBe("http://gate.decodo.com:10001");
  });

  it("loads residential endpoints from CLEARBOLT_PROXY_ENDPOINTS_FILE", () => {
    const path = join(
      tmpdir(),
      `clearbolt-proxy-${randomBytes(4).toString("hex")}.txt`,
    );
    writeFileSync(
      path,
      "https://spnpt7lvn9:secret@us.decodo.com:10001\nhttps://spnpt7lvn9:secret@us.decodo.com:10002\n",
    );
    process.env.CLEARBOLT_PROXY_ENDPOINTS_FILE = path;
    process.env.CLEARBOLT_PROXY_USERNAME_STYLE = "decodo";
    process.env.CLEARBOLT_PROXY_SESSION_ID = "page-1";
    const ep = resolveProxyEndpoint("residential", "page-1");
    expect(ep?.server).toMatch(/^http:\/\/us\.decodo\.com:1000[12]$/);
    expect(ep?.username).toContain("session-page-1");
    unlinkSync(path);
  });
});

describe("pickProxyEndpointFromList worker index", () => {
  const endpoints = Array.from({ length: 50 }, (_, i) => ({
    server: `http://us.decodo.com:${10001 + i}`,
    username: "u",
    password: "p",
  }));

  it("maps -wN- in session key to port index N", () => {
    expect(
      pickProxyEndpointFromList(endpoints, "clearbolt-w0-g1")?.server,
    ).toBe("http://us.decodo.com:10001");
    expect(
      pickProxyEndpointFromList(endpoints, "clearbolt-w49-g2")?.server,
    ).toBe("http://us.decodo.com:10050");
  });
});
