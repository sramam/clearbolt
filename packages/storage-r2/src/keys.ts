/** File extension from content type (matches DiskEvidenceStore). */
export function extForContentType(contentType: string): string {
  if (contentType.includes("json")) return "json";
  if (contentType.includes("markdown")) return "md";
  return "html";
}

/** Shared scraper cache: `shared/<adapter>/<sha256>.<ext>`. */
export function sharedEvidenceKey(
  adapter: string,
  sha256: string,
  contentType: string,
): string {
  return `shared/${adapter}/${sha256}.${extForContentType(contentType)}`;
}

/** Workspace-private evidence (V1+ when PutMeta carries workspaceId). */
export function workspaceEvidenceKey(
  workspaceId: string,
  subArea: string,
  sha256: string,
  contentType: string,
): string {
  return `workspaces/${workspaceId}/${subArea}/${sha256}.${extForContentType(contentType)}`;
}
