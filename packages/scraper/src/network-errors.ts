/** True for proxy/connect/socket failures that are worth retrying. */
export function isTransientNetworkError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const cause = (err as { cause?: unknown })?.cause;
  const causeMsg = cause instanceof Error ? cause.message : String(cause ?? "");
  const code =
    (err as { code?: string }).code ??
    (cause as { code?: string } | undefined)?.code;
  return (
    /fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|socket hang up|EPIPE|ENOTFOUND|Request was cancelled/i.test(
      `${msg} ${causeMsg}`,
    ) ||
    code === "UND_ERR_CONNECT_TIMEOUT" ||
    code === "UND_ERR_HEADERS_TIMEOUT" ||
    code === "UND_ERR_BODY_TIMEOUT" ||
    code === "UND_ERR_SOCKET"
  );
}
