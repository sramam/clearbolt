import { extForContentType } from "./keys.js";

/** Processed derivatives: `shared/<adapter>/processed/<kind>/<sha256>.<ext>`. */
export function processedArtifactKey(
  adapter: string,
  kind: string,
  sha256: string,
  contentType: string,
): string {
  return `shared/${adapter}/processed/${kind}/${sha256}.${extForContentType(contentType)}`;
}
