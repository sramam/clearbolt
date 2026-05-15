import { X509Certificate } from "node:crypto";
import http from "node:http";
import https from "node:https";
import tls from "node:tls";
import { URL } from "node:url";
import forge from "node-forge";

const OID_CA_ISSUERS = "1.3.6.1.5.5.7.48.2";

const agentCache = new Map<string, https.Agent>();
const inflight = new Map<string, Promise<https.Agent>>();

function cacheKey(host: string, port: number): string {
  return `${host}:${port}`;
}

function extractCaIssuersUrl(leafDer: Buffer): string | null {
  const cert = forge.pki.certificateFromAsn1(
    forge.asn1.fromDer(leafDer.toString("binary")),
  );
  const ext = cert.getExtension("authorityInfoAccess") as
    | { value: string }
    | undefined;
  if (!ext?.value) return null;
  const top = forge.asn1.fromDer(ext.value);
  const pairs = top.value as forge.asn1.Asn1[] | undefined;
  if (!Array.isArray(pairs)) return null;
  for (const pair of pairs) {
    const seq = pair.value as forge.asn1.Asn1[] | undefined;
    if (!Array.isArray(seq) || seq.length < 2) continue;
    const oidNode = seq[0];
    const locNode = seq[1];
    if (oidNode?.type !== forge.asn1.Type.OID) continue;
    const oid = forge.asn1.derToOid(
      forge.util.createBuffer(oidNode.value as string),
    );
    if (oid === OID_CA_ISSUERS && typeof locNode.value === "string") {
      return locNode.value;
    }
  }
  return null;
}

function fetchIssuerDer(caUrl: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const u = new URL(caUrl);
    const lib = u.protocol === "http:" ? http : https;
    lib
      .get(caUrl, (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`AIA issuer fetch ${res.statusCode} for ${caUrl}`));
          res.resume();
          return;
        }
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => {
          chunks.push(c);
        });
        res.on("end", () => {
          resolve(Buffer.concat(chunks));
        });
      })
      .on("error", reject);
  });
}

function readLeafDer(host: string, port: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const socket = tls.connect(
      { host, port, servername: host, rejectUnauthorized: false },
      () => {
        try {
          const peer = socket.getPeerCertificate();
          if (!peer?.raw) {
            reject(new Error(`tls-aia: no peer certificate for ${host}`));
            return;
          }
          resolve(Buffer.from(peer.raw));
        } finally {
          socket.destroy();
        }
      },
    );
    socket.on("error", reject);
  });
}

async function buildAiaAgent(host: string, port: number): Promise<https.Agent> {
  const leafDer = await readLeafDer(host, port);
  const caUrl = extractCaIssuersUrl(leafDer);
  if (!caUrl) {
    throw new Error(`tls-aia: no CA Issuers URL in AIA for ${host}`);
  }
  const issuerDer = await fetchIssuerDer(caUrl);
  const issuerPem = new X509Certificate(issuerDer).toString();
  const ca = [...tls.rootCertificates, issuerPem].join("\n");
  return new https.Agent({ ca, keepAlive: true });
}

/**
 * Returns an `https.Agent` whose CA bundle includes the intermediate fetched
 * via the leaf certificate's AIA "CA Issuers" URL. Cached per host:port.
 */
export function getHttpsAgentWithAiaForHost(
  host: string,
  port: number,
): Promise<https.Agent> {
  const key = cacheKey(host, port);
  const cached = agentCache.get(key);
  if (cached) return Promise.resolve(cached);
  const pending = inflight.get(key);
  if (pending) return pending;
  const p = buildAiaAgent(host, port)
    .then((agent) => {
      agentCache.set(key, agent);
      inflight.delete(key);
      return agent;
    })
    .catch((err) => {
      inflight.delete(key);
      throw err;
    });
  inflight.set(key, p);
  return p;
}

/** @internal tests */
export function __testExtractCaIssuersUrl(leafDer: Buffer): string | null {
  return extractCaIssuersUrl(leafDer);
}

/** @internal tests */
export function __testClearAiaAgentCache(): void {
  agentCache.clear();
  inflight.clear();
}
