import type { FetchRequest, RawResponse } from "@clearbolt/core";
import type { Fetcher } from "./fetcher.js";

/** One in-flight request at a time (shared Playwright context, etc.). */
export function serializedFetcher(inner: Fetcher): Fetcher {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    fetch(req: FetchRequest): Promise<RawResponse> {
      const job = tail.then(() => inner.fetch(req));
      tail = job.then(
        () => undefined,
        () => undefined,
      );
      return job;
    },
  };
}
