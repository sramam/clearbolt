import { describe, expect, it } from "vitest";
import {
  IngestFailureCollector,
  formatIngestError,
  ingestErrorBucket,
} from "../src/ingest-failure-log.js";

describe("ingest failure log", () => {
  it("formats Error with cause", () => {
    const err = new Error("fetch failed", {
      cause: new Error("net::ERR_TUNNEL_CONNECTION_FAILED"),
    });
    expect(formatIngestError(err)).toContain("fetch failed");
    expect(formatIngestError(err)).toContain("TUNNEL");
  });

  it("buckets messages for summary", () => {
    const a = ingestErrorBucket(
      "Failed https://www.bizbuysell.com/business-opportunity/x/2507133/",
    );
    const b = ingestErrorBucket(
      "Failed https://www.bizbuysell.com/business-opportunity/y/2494514/",
    );
    expect(a).toBe(b);
  });

  it("groups failures in printSummary", () => {
    const c = new IngestFailureCollector();
    c.record(
      { url: "https://example.com/a/1/", externalId: "1" },
      new Error("timeout"),
    );
    c.record(
      { url: "https://example.com/b/2/", externalId: "2" },
      new Error("timeout"),
    );
    expect(c.count).toBe(2);
  });
});
