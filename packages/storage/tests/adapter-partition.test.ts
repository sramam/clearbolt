import { describe, expect, it } from "vitest";
import { dedupKeyAdapter, hostToAdapter } from "../src/adapter-partition.js";

describe("adapter partition", () => {
  it("maps bizben host to bizben adapter", () => {
    expect(hostToAdapter("www.bizben.com")).toBe("bizben");
    expect(
      dedupKeyAdapter({
        kind: "url",
        value:
          "https://www.bizben.com/business-for-sale/example-for-sale-123456",
      }),
    ).toBe("bizben");
  });
});
