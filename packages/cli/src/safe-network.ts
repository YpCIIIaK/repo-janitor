import { lookup } from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import { BlockList, isIP } from "node:net";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

const blocked = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
  ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blocked.addSubnet(address, prefix, "ipv4");

/** IPv6 is restricted to global unicast, excluding transition/tunnel ranges. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blocked.check(address, "ipv4");
  if (family !== 6) return false;
  const global = new BlockList();
  global.addSubnet("2000::", 3, "ipv6");
  const excluded = new BlockList();
  excluded.addSubnet("2001::", 23, "ipv6");
  excluded.addSubnet("2001:db8::", 32, "ipv6");
  excluded.addSubnet("2002::", 16, "ipv6");
  return global.check(address, "ipv6") && !excluded.check(address, "ipv6");
}

export interface SafeResponse { status: number; url: string; text: string }

/** Resolve once and pin the socket to the checked address, including redirects.
 * TLS still verifies the original hostname. No ambient credentials or proxy env.
 */
export async function safeRequest(
  input: string,
  options: { method?: "GET" | "HEAD" | "POST"; body?: string } = {},
): Promise<SafeResponse> {
  const signal = AbortSignal.timeout(8_000);
  let url = new URL(input);
  for (let hop = 0; hop < 5; hop++) {
    if (!/^https?:$/.test(url.protocol) || url.username || url.password ||
      (url.port && url.port !== "80" && url.port !== "443")) throw new Error("Unsafe URL");
    const host = url.hostname.replace(/^\[|\]$/g, "");
    // Bound resolution too; the socket timeout alone does not cover DNS.
    const addresses = await new Promise<LookupAddress[]>((resolve, reject) => {
      const abort = () => reject(new Error("DNS timeout"));
      signal.addEventListener("abort", abort, { once: true });
      lookup(host, { all: true }).then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
      if (signal.aborted) abort();
    });
    if (!addresses.length || addresses.some((a) => !isPublicAddress(a.address))) throw new Error("Non-public destination");
    const address = addresses[0];
    const result = await new Promise<SafeResponse & { location?: string }>((resolve, reject) => {
      const send = url.protocol === "https:" ? httpsRequest : httpRequest;
      const req = send(url, {
        method: options.method || "GET", signal,
        lookup: (_hostname, opts, callback) => {
          if (opts.all) callback(null, [address]);
          else callback(null, address.address, address.family);
        },
        headers: {
          "user-agent": "repo-anti-rot",
          accept: "application/json",
          ...(options.body ? { "content-type": "application/json" } : {}),
        },
      }, (res) => {
        const status = res.statusCode || 0;
        const location = res.headers.location;
        if (options.method === "HEAD" || location && status >= 300 && status < 400) {
          res.destroy();
          resolve({ status, url: url.href, text: "", location });
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > 4 * 1024 * 1024) res.destroy(new Error("Response too large"));
          else chunks.push(chunk);
        });
        res.on("error", reject);
        res.on("end", () => resolve({ status, url: url.href, text: Buffer.concat(chunks).toString("utf8") }));
      });
      req.on("error", reject);
      req.end(options.body);
    });
    if (result.location && result.status >= 300 && result.status < 400) {
      if (options.method === "POST") throw new Error("POST redirects are not allowed");
      url = new URL(result.location, url);
      continue;
    }
    return result;
  }
  throw new Error("Too many redirects");
}
