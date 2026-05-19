import type { BrokerDirectoryRef } from "@clearbolt/scraper";
import { writeBrokerRefsFile } from "@clearbolt/scraper";
import { fetchIbbaBrokerRefs } from "./adapters/ibba.js";
import {
  type AzDreSearchParams,
  fetchAzDreBrokerRefs,
} from "./adapters/state-dre-az.js";
import {
  type CaDreSearchParams,
  fetchCaDreBrokerRefs,
} from "./adapters/state-dre-ca.js";
import {
  type FlDreSearchParams,
  fetchFlDreBrokerRefs,
} from "./adapters/state-dre-fl.js";
import { fetchSunbeltBrokerRefs } from "./adapters/sunbelt.js";
import { fetchTransworldBrokerRefs } from "./adapters/transworld.js";
import { defaultBrokerRefsPathForAdapter } from "./broker-refs-path.js";

export const BROKER_DIRECTORY_ADAPTER_IDS = [
  "ibba",
  "transworld",
  "sunbelt",
  "state-dre-ca",
  "state-dre-fl",
  "state-dre-az",
] as const;

export type BrokerDirectoryAdapterId =
  (typeof BROKER_DIRECTORY_ADAPTER_IDS)[number];

export function isBrokerDirectoryAdapterId(
  value: string,
): value is BrokerDirectoryAdapterId {
  return (BROKER_DIRECTORY_ADAPTER_IDS as readonly string[]).includes(value);
}

export type RunBrokerDirectoryDiscoveryOptions = {
  adapter: BrokerDirectoryAdapterId;
  dataRootDir?: string;
  discoverOut?: string;
  stateCode?: string;
  countryCode?: string;
  city?: string;
  lastName?: string;
  caDre?: CaDreSearchParams;
  flDre?: FlDreSearchParams;
  azDre?: AzDreSearchParams;
  onProgress?: (message: string) => void;
};

export type RunBrokerDirectoryDiscoveryResult = {
  adapter: BrokerDirectoryAdapterId;
  refs: BrokerDirectoryRef[];
  outputPath: string;
};

function defaultSlug(
  adapter: BrokerDirectoryAdapterId,
  options: RunBrokerDirectoryDiscoveryOptions,
): string {
  if (adapter === "ibba") {
    const cc = options.countryCode?.toLowerCase();
    const st = options.stateCode?.toLowerCase();
    if (cc && st) return `country-${cc}-state-${st}`;
    if (cc) return `country-${cc}`;
    if (st) return `us-${st}`;
    return "all";
  }
  if (
    adapter === "state-dre-ca" ||
    adapter === "state-dre-fl" ||
    adapter === "state-dre-az"
  ) {
    const city = options.city ?? options.caDre?.cityState ?? "search";
    return slugify(city);
  }
  return "all";
}

function slugify(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "search"
  );
}

export async function runBrokerDirectoryDiscovery(
  options: RunBrokerDirectoryDiscoveryOptions,
): Promise<RunBrokerDirectoryDiscoveryResult> {
  const dataRoot = options.dataRootDir ?? process.env.DATA_DIR ?? "data";
  const slug = defaultSlug(options.adapter, options);
  const outputPath =
    options.discoverOut ??
    defaultBrokerRefsPathForAdapter(options.adapter, slug, dataRoot);

  options.onProgress?.(`Discovering brokers via ${options.adapter}…`);

  let refs: BrokerDirectoryRef[];
  switch (options.adapter) {
    case "ibba":
      refs = await fetchIbbaBrokerRefs({
        countryCode: options.countryCode,
        stateCode: options.stateCode,
      });
      break;
    case "transworld":
      refs = await fetchTransworldBrokerRefs();
      break;
    case "sunbelt":
      refs = await fetchSunbeltBrokerRefs();
      break;
    case "state-dre-ca": {
      const cityState = options.city ?? options.caDre?.cityState;
      const licenseeName = options.caDre?.licenseeName;
      if (
        !cityState?.trim() &&
        !licenseeName?.trim() &&
        !options.caDre?.licenseId
      ) {
        throw new Error(
          "CA DRE discovery requires --city (mailing city) or --license-name",
        );
      }
      refs = await fetchCaDreBrokerRefs({
        cityState,
        licenseeName,
        licenseId: options.caDre?.licenseId,
      });
      break;
    }
    case "state-dre-fl":
      refs = await fetchFlDreBrokerRefs({
        lastName: options.lastName ?? options.flDre?.lastName,
        city: options.city ?? options.flDre?.city,
        county: options.flDre?.county,
      });
      break;
    case "state-dre-az":
      refs = await fetchAzDreBrokerRefs({
        city: options.city ?? options.azDre?.city,
        lastName: options.lastName ?? options.azDre?.lastName,
        firstName: options.azDre?.firstName,
        licenseNo: options.azDre?.licenseNo,
      });
      if (!options.city && !options.azDre?.city && !options.lastName) {
        throw new Error("AZ ADRE discovery requires --city or --last-name");
      }
      break;
    default:
      throw new Error(
        `Unsupported adapter: ${options.adapter satisfies never}`,
      );
  }

  options.onProgress?.(`Writing ${refs.length} broker ref(s) → ${outputPath}`);

  await writeBrokerRefsFile(outputPath, {
    adapter: options.adapter,
    directoryUrl: `broker-directory://${options.adapter}/${slug}`,
    refs,
    complete: true,
  });

  return { adapter: options.adapter, refs, outputPath };
}
