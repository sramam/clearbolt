import { describe, expect, it } from "vitest";
import {
  htmlListingBodyFingerprint,
  htmlListingBodyText,
} from "../src/html-body-fingerprint.js";

describe("htmlListingBodyFingerprint", () => {
  it("ignores script and tags for stable text", () => {
    const html =
      "<html><script>evil()</script><body><p>  Hello  </p><style>.x{}</style>World</body></html>";
    expect(htmlListingBodyText(html)).toContain("hello");
    expect(htmlListingBodyText(html)).toContain("world");
    expect(htmlListingBodyFingerprint(html)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("same visible text yields same fingerprint", () => {
    const a = "<div>Price $100</div>";
    const b = "<span>Price $100</span>";
    expect(htmlListingBodyFingerprint(a)).toBe(htmlListingBodyFingerprint(b));
  });
});
