import { brokerRefsPath } from "./adapter-scoped-paths.js";

export function directoryPathSlugFromUrl(directoryUrl: string): string {
  try {
    return (
      new URL(directoryUrl).pathname.replace(/^\/+|\/+$/g, "") || "brokers"
    );
  } catch {
    return "brokers";
  }
}

export function defaultBrokerRefsPath(
  directoryUrl: string,
  dataRootDir = "data",
  adapter = "bizbuysell",
): string {
  const pathSlug = directoryPathSlugFromUrl(directoryUrl);
  return brokerRefsPath(dataRootDir, adapter, pathSlug);
}

export { brokerRefsPath };
