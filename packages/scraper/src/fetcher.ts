import type { FetchRequest, RawResponse } from "@clearbolt/core";

export interface Fetcher {
  fetch(req: FetchRequest): Promise<RawResponse>;
}
