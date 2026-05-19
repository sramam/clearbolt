import { describe, expect, it } from "vitest";
import {
  parseProxyEndpointLine,
  parseProxyEndpointsFileContent,
  pickProxyEndpointFromList,
} from "../src/proxy-endpoints-file.js";

describe("proxy-endpoints-file", () => {
  it("parses https Decodo dashboard URLs", () => {
    const ep = parseProxyEndpointLine(
      "https://user:secret_pass@us.decodo.com:10007",
    );
    expect(ep).toEqual({
      server: "http://us.decodo.com:10007",
      username: "user",
      password: "secret_pass",
    });
  });

  it("parses host:port:user:pass lines", () => {
    const ep = parseProxyEndpointLine(
      "us.decodo.com:10001:user:pass:with:colons",
    );
    expect(ep?.server).toBe("http://us.decodo.com:10001");
    expect(ep?.password).toBe("pass:with:colons");
  });

  it("picks endpoints deterministically by session key", () => {
    const lines = parseProxyEndpointsFileContent(`
# comment
https://u:p@us.decodo.com:10001
https://u:p@us.decodo.com:10002
https://u:p@us.decodo.com:10003
`);
    expect(lines).toHaveLength(3);
    const a = pickProxyEndpointFromList(lines, "catalog-page-2");
    const b = pickProxyEndpointFromList(lines, "catalog-page-2");
    expect(a?.server).toBe(b?.server);
    const ports = new Set(
      ["catalog-page-1", "catalog-page-2", "catalog-page-3", "listing-99"].map(
        (k) => pickProxyEndpointFromList(lines, k)?.server,
      ),
    );
    expect(ports.size).toBeGreaterThan(1);
  });
});
