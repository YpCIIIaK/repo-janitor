import { lookup } from "node:dns/promises"

/**
 * SSRF guard for server-side `git clone`.
 *
 * The scan route clones whatever URL a caller supplies. Without a host check that
 * is an SSRF primitive: `git clone http://169.254.169.254/...` makes the server
 * reach cloud-metadata / internal services. We therefore reject non-public hosts
 * — both IP literals and DNS names that resolve to private space (which also
 * blunts DNS-rebinding by checking every resolved address before the clone).
 */

/** Parse a dotted IPv4 string to its four octets, or null if malformed. */
function parseIpv4(ip: string): [number, number, number, number] | null {
  const parts = ip.split(".")
  if (parts.length !== 4) return null
  const nums = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : -1))
  if (nums.some((n) => n < 0 || n > 255)) return null
  return nums as [number, number, number, number]
}

/** True for loopback / private / link-local / reserved / multicast IPv4. */
function isPrivateIpv4(ip: string): boolean {
  const o = parseIpv4(ip)
  if (!o) return false
  const [a, b] = o
  if (a === 0) return true // 0.0.0.0/8 "this network"
  if (a === 10) return true // 10/8 private
  if (a === 127) return true // 127/8 loopback
  if (a === 100 && b >= 64 && b <= 127) return true // 100.64/10 CGNAT
  if (a === 169 && b === 254) return true // 169.254/16 link-local (incl. metadata)
  if (a === 172 && b >= 16 && b <= 31) return true // 172.16/12 private
  if (a === 192 && b === 168) return true // 192.168/16 private
  if (a === 192 && b === 0 && o[2] === 0) return true // 192.0.0/24 IETF
  if (a === 198 && (b === 18 || b === 19)) return true // 198.18/15 benchmark
  if (a >= 224) return true // 224/4 multicast + 240/4 reserved + 255.255.255.255
  return false
}

/** True for loopback / link-local / unique-local / mapped-private IPv6. */
function isPrivateIpv6(raw: string): boolean {
  let ip = raw.toLowerCase()
  if (ip.startsWith("[") && ip.endsWith("]")) ip = ip.slice(1, -1)
  // Strip a zone id (fe80::1%eth0).
  const pct = ip.indexOf("%")
  if (pct !== -1) ip = ip.slice(0, pct)

  if (ip === "::1" || ip === "::") return true // loopback / unspecified
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d) → judge the v4.
  const mapped = ip.match(/(?:^::ffff:|^::)(\d+\.\d+\.\d+\.\d+)$/)
  if (mapped) return isPrivateIpv4(mapped[1])
  if (ip.startsWith("fe8") || ip.startsWith("fe9") || ip.startsWith("fea") || ip.startsWith("feb"))
    return true // fe80::/10 link-local
  if (ip.startsWith("fc") || ip.startsWith("fd")) return true // fc00::/7 unique-local
  if (ip.startsWith("ff")) return true // ff00::/8 multicast
  return false
}

/** True when an IP literal is private/loopback/link-local/reserved/multicast. */
export function isPrivateIp(ip: string): boolean {
  return ip.includes(":") ? isPrivateIpv6(ip) : isPrivateIpv4(ip)
}

/** Normalize a URL hostname: lowercase, strip IPv6 brackets and a trailing dot. */
function normalizeHost(hostname: string): string {
  let h = hostname.toLowerCase()
  if (h.startsWith("[") && h.endsWith("]")) h = h.slice(1, -1)
  if (h.endsWith(".")) h = h.slice(0, -1)
  return h
}

const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".intranet", ".lan", ".home", ".corp"]

/**
 * True when a hostname must never be reached: localhost, a single-label name (no
 * dot → an internal/short name, never a public git host), an internal-use TLD, or
 * an IP literal in private space. DNS names that resolve privately are caught
 * later by the async resolve step.
 */
export function isBlockedHost(hostname: string): boolean {
  const h = normalizeHost(hostname)
  if (!h) return true
  if (h === "localhost") return true
  if (BLOCKED_SUFFIXES.some((s) => h.endsWith(s))) return true
  // An IP literal: judge it directly.
  if (parseIpv4(h) || h.includes(":")) return isPrivateIp(h)
  // A bare single-label hostname ("intranet", "git") is not a public FQDN.
  if (!h.includes(".")) return true
  return false
}

export interface GitUrlCheck {
  ok: boolean
  /** present when ok === false */
  reason?: string
}

/** Resolver seam so tests can avoid real DNS. Returns resolved IP strings. */
export type HostResolver = (host: string) => Promise<string[]>

const defaultResolver: HostResolver = async (host) => {
  const records = await lookup(host, { all: true })
  return records.map((r) => r.address)
}

/**
 * Validate that `url` is a public http(s) git URL safe to clone server-side.
 * Rejects non-http(s) schemes, blocked/loopback/private hosts, and DNS names
 * whose resolved addresses include any private IP. Resolution failure is treated
 * as a rejection (we don't clone what we can't vet).
 */
export async function isPublicGitUrl(url: string, resolve: HostResolver = defaultResolver): Promise<GitUrlCheck> {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return { ok: false, reason: "not a valid URL" }
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return { ok: false, reason: "only http(s) URLs are allowed" }
  }
  const host = normalizeHost(u.hostname)
  if (isBlockedHost(host)) {
    return { ok: false, reason: "host is loopback/private/internal" }
  }
  // IP literal already vetted by isBlockedHost; only DNS names need resolving.
  if (parseIpv4(host) || host.includes(":")) return { ok: true }

  let addresses: string[]
  try {
    addresses = await resolve(host)
  } catch {
    return { ok: false, reason: "host does not resolve" }
  }
  if (addresses.length === 0) return { ok: false, reason: "host does not resolve" }
  if (addresses.some((ip) => isPrivateIp(ip))) {
    return { ok: false, reason: "host resolves to a private address" }
  }
  return { ok: true }
}
