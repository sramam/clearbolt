export type { BrokerDirectoryRef } from "@clearbolt/scraper";
export {
  BIZBUYSELL_CALIFORNIA_BROKER_DIRECTORY_URL,
  isBizBuySellBrokerDirectoryUrl,
  defaultBrokerRefsPath,
  readBrokerRefsFile,
  writeBrokerRefsFile,
  runBizBuySellBrokerDirectoryScrapeWithBrowser,
} from "@clearbolt/scraper";

export {
  BROKER_DIRECTORY_ADAPTER_IDS,
  isBrokerDirectoryAdapterId,
  runBrokerDirectoryDiscovery,
  type BrokerDirectoryAdapterId,
  type RunBrokerDirectoryDiscoveryOptions,
  type RunBrokerDirectoryDiscoveryResult,
} from "./run-broker-directory-discovery.js";

export { defaultBrokerRefsPathForAdapter } from "./broker-refs-path.js";
export { websiteDomainFromUrl, slugifySegment } from "./website-domain.js";

export {
  fetchIbbaBrokerRefs,
  filterIbbaBrokerRefs,
  normalizeIbbaCountryCode,
  parseIbbaBrokersAllJson,
  ibbaRecordToBrokerDirectoryRef,
  IBBA_BROKERS_ALL_URL,
} from "./adapters/ibba.js";

export {
  fetchTransworldBrokerRefs,
  discoverTransworldBrokerRefsFromSitemap,
  isTransworldOfficeLocationUrl,
  TRANSWORLD_LOCATIONS_SITEMAP_URL,
} from "./adapters/transworld.js";

export {
  fetchSunbeltBrokerRefs,
  discoverSunbeltBrokerRefsFromHtml,
  isSunbeltOfficeUrl,
  SUNBELT_LOCATIONS_URL,
} from "./adapters/sunbelt.js";

export {
  fetchCaDreBrokerRefs,
  discoverCaDreBrokerRefsFromResultsHtml,
  CA_DRE_PPL_SEARCH_URL,
} from "./adapters/state-dre-ca.js";

export {
  fetchFlDreBrokerRefs,
  discoverFlDreBrokerRefsFromResultsHtml,
  FL_DBPR_LICENSE_SEARCH_URL,
} from "./adapters/state-dre-fl.js";

export {
  fetchAzDreBrokerRefs,
  discoverAzDreBrokerRefsFromResultsHtml,
  AZ_ADRE_SEARCH_URL,
} from "./adapters/state-dre-az.js";
