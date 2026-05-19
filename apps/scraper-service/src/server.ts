import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runBizBuySellCatalogScrapeWithBrowser } from "@clearbolt/scraper/run-bizbuysell-catalog-scrape";
import { isBizBuySellCatalogUrl } from "@clearbolt/scraper";
import { runBizBuySellScrape } from "@clearbolt/scraper/run-bizbuysell-scrape";
import dotenv from "dotenv";
import { bindStorage } from "./bind-storage.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
for (const name of [".env.cloud.local", ".env.dev", ".env"]) {
  dotenv.config({ path: join(repoRoot, name) });
}

const PORT = Number.parseInt(process.env.PORT ?? "8791", 10);
const SECRET = process.env.CLEARBOLT_SCRAPER_SERVICE_SECRET?.trim() ?? "";

type ScrapeBody = {
  searchUrl: string;
  searchKeywords?: string;
  limit?: number;
  useFixtures?: boolean;
  discovery?: "serper" | "direct" | "fixtures";
  skipBrowser?: boolean;
};

type CatalogBody = {
  catalogUrl: string;
  maxPages?: number;
  maxListings?: number;
  ingestLimit?: number;
  useFixtures?: boolean;
  skipBrowser?: boolean;
  preferMobile?: boolean;
};

function unauthorized(res: ServerResponse): void {
  res.writeHead(401, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "unauthorized" }));
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function checkAuth(req: IncomingMessage, res: ServerResponse): boolean {
  if (!SECRET) return true;
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (token !== SECRET) {
    unauthorized(res);
    return false;
  }
  return true;
}

async function handleBizBuySellScrape(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!checkAuth(req, res)) return;

  let body: ScrapeBody;
  try {
    body = (await readJson(req)) as ScrapeBody;
  } catch {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "invalid_json" }));
    return;
  }

  if (!body.searchUrl?.trim()) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "searchUrl required" }));
    return;
  }

  if (isBizBuySellCatalogUrl(body.searchUrl) && body.discovery !== "serper") {
    return handleBizBuySellCatalog(req, res, {
      catalogUrl: body.searchUrl,
      ingestLimit: body.limit,
      useFixtures: body.useFixtures,
      skipBrowser: body.skipBrowser,
    });
  }

  res.writeHead(200, {
    "Content-Type": "application/x-ndjson",
    "Cache-Control": "no-store",
  });

  const send = (obj: Record<string, unknown>) => {
    res.write(`${JSON.stringify(obj)}\n`);
  };

  send({ step: "start", message: "Scraper service ready (Fly / local)" });

  const { evidence, processedArtifacts, metadata, disconnect } =
    await bindStorage();
  try {
    const result = await runBizBuySellScrape({
      searchUrl: body.searchUrl,
      searchKeywords: body.searchKeywords,
      evidence,
      processedArtifacts,
      metadata,
      limit: body.limit,
      useFixtures: body.useFixtures,
      discovery: body.discovery ?? "direct",
      skipBrowser: body.skipBrowser,
      onProgress: (ev: {
        phase: string;
        message: string;
        current?: number;
        total?: number;
      }) => {
        send({
          step: ev.phase,
          message: ev.message,
          current: ev.current,
          total: ev.total,
        });
      },
    });
    send({ step: "result", ...result });
    send({ step: "done", message: "complete" });
  } catch (e) {
    send({
      step: "error",
      message: e instanceof Error ? e.message : String(e),
    });
  } finally {
    await disconnect?.();
    res.end();
  }
}

async function handleBizBuySellCatalog(
  req: IncomingMessage,
  res: ServerResponse,
  prefilled?: CatalogBody,
): Promise<void> {
  if (!checkAuth(req, res)) return;

  let body: CatalogBody;
  if (prefilled) {
    body = prefilled;
  } else {
    try {
      body = (await readJson(req)) as CatalogBody;
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "invalid_json" }));
      return;
    }
  }

  if (!body.catalogUrl?.trim()) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "catalogUrl required" }));
    return;
  }

  res.writeHead(200, {
    "Content-Type": "application/x-ndjson",
    "Cache-Control": "no-store",
  });

  const send = (obj: Record<string, unknown>) => {
    res.write(`${JSON.stringify(obj)}\n`);
  };

  send({ step: "start", message: "Catalog scrape (paginated)" });

  const { evidence, processedArtifacts, metadata, disconnect } =
    await bindStorage();
  try {
    const result = await runBizBuySellCatalogScrapeWithBrowser({
      catalogUrl: body.catalogUrl,
      evidence,
      processedArtifacts,
      metadata,
      maxPages: body.maxPages,
      maxListings: body.maxListings,
      ingestLimit: body.ingestLimit,
      useFixtures: body.useFixtures,
      skipBrowser: body.skipBrowser,
      preferMobile: body.preferMobile,
      onProgress: (ev) => {
        send({
          step: ev.phase,
          message: ev.message,
          current: ev.current,
          total: ev.total,
        });
      },
    });
    send({ step: "result", ...result });
    send({ step: "done", message: "complete" });
  } catch (e) {
    send({
      step: "error",
      message: e instanceof Error ? e.message : String(e),
    });
  } finally {
    await disconnect?.();
    res.end();
  }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    if (req.method === "GET" && url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, service: "clearbolt-scraper" }));
      return;
    }

    if (
      req.method === "POST" &&
      url.pathname === "/v1/bizbuysell/scrape"
    ) {
      await handleBizBuySellScrape(req, res);
      return;
    }

    if (
      req.method === "POST" &&
      url.pathname === "/v1/bizbuysell/catalog-scrape"
    ) {
      await handleBizBuySellCatalog(req, res);
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not_found" }));
  } catch (e) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: e instanceof Error ? e.message : "internal_error",
      }),
    );
  }
});

server.listen(PORT, () => {
  console.log(`@clearbolt/scraper-service listening on :${PORT}`);
});
