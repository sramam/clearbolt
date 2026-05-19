import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  filterIbbaBrokerRefs,
  ibbaRecordToBrokerDirectoryRef,
  normalizeIbbaCountryCode,
  parseIbbaBrokersAllJson,
} from "../src/adapters/ibba.js";

const fixtureDir = dirname(fileURLToPath(import.meta.url));

describe("ibba adapter", () => {
  it("maps API record to BrokerDirectoryRef with designations and website", async () => {
    const raw = await readFile(
      join(fixtureDir, "fixtures/ibba-one.json"),
      "utf8",
    );
    const refs = parseIbbaBrokersAllJson(JSON.parse(raw));
    expect(refs).toHaveLength(1);
    const ref = refs[0]!;
    expect(ref.sourceAdapter).toBe("ibba");
    expect(ref.state).toBe("CA");
    expect(ref.country).toBe("US");
    expect(ref.designations).toContain("CBI");
    expect(ref.websiteDomain).toBe("sunbeltnetwork.com");
    expect(ref.profileUrl).toContain("broker-profile");
    expect(ibbaRecordToBrokerDirectoryRef(JSON.parse(raw)[0]).externalBrokerId).toBe(
      "43939435",
    );
  });

  it("filters by country without conflating Canada and California", async () => {
    const raw = await readFile(join(fixtureDir, "fixtures/ibba-one.json"), "utf8");
    const us = ibbaRecordToBrokerDirectoryRef(JSON.parse(raw)[0]);
    const canada = ibbaRecordToBrokerDirectoryRef({
      id: "2",
      first_name: "Jane",
      last_name: "Doe",
      state_code: "ON",
      country_code: "CA",
    });
    const refs = [us, canada];
    expect(filterIbbaBrokerRefs(refs, { countryCode: "US" })).toHaveLength(1);
    expect(filterIbbaBrokerRefs(refs, { countryCode: "CA" })).toHaveLength(1);
    expect(filterIbbaBrokerRefs(refs, { stateCode: "CA" })).toHaveLength(1);
    expect(normalizeIbbaCountryCode("Canada")).toBe("CA");
  });
});
