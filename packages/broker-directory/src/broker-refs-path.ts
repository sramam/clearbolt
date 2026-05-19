import { brokerRefsPath } from "@clearbolt/scraper";

export function defaultBrokerRefsPathForAdapter(
  adapter: string,
  slug: string,
  dataRootDir = "data",
): string {
  return brokerRefsPath(dataRootDir, adapter, slug);
}
