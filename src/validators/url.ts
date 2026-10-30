import { promises as dns } from 'dns';
import type { LookupAddress } from 'dns';
import { isIP, isIPv4, isIPv6 } from 'net';
import { URL } from 'url';
import type { UrlValidationResult } from '../types/index.js';

/** Injectable DNS resolver for testing and IP pinning (SEC-001). */
export interface DnsResolver {
  lookup(hostname: string, options: { all: true }): Promise<LookupAddress[]>;
}

const defaultDnsResolver: DnsResolver = {
  lookup: (hostname, options) => dns.lookup(hostname, options),
};

/** Options for URL validation. */
export interface ValidateUrlOptions {
  /** Allow loopback addresses (127.x, ::1, localhost). Other private ranges stay blocked. */
  allowLocal?: boolean;
  /** Custom DNS resolver for testing. */
  dnsResolver?: DnsResolver;
}

/** Result of checking a single IP address against the SSRF policy. */
export interface IpCheckResult {
  blocked: boolean;
  reason?: string;
}

interface Ipv4Range {
  base: string;
  prefix: number;
  reason: string;
}

/**
 * Every IPv4 block that is not globally reachable unicast (IANA special-purpose
 * registry, plus multicast and reserved space). Anything outside these ranges
 * is ordinary public unicast.
 */
const BLOCKED_IPV4_RANGES: readonly Ipv4Range[] = [
  { base: '0.0.0.0', prefix: 8, reason: 'Access to 0.x.x.x addresses is not allowed' },
  { base: '10.0.0.0', prefix: 8, reason: 'Access to private network (10.x.x.x) is not allowed' },
  { base: '100.64.0.0', prefix: 10, reason: 'Access to shared/CGNAT addresses (100.64-127.x.x) is not allowed' },
  { base: '127.0.0.0', prefix: 8, reason: 'Access to loopback addresses is not allowed' },
  { base: '169.254.0.0', prefix: 16, reason: 'Access to link-local/metadata addresses (169.254.x.x) is not allowed' },
  { base: '172.16.0.0', prefix: 12, reason: 'Access to private network (172.16-31.x.x) is not allowed' },
  { base: '192.0.0.0', prefix: 24, reason: 'Access to IETF protocol assignment addresses (192.0.0.x) is not allowed' },
  { base: '192.0.2.0', prefix: 24, reason: 'Access to documentation addresses (TEST-NET-1, 192.0.2.x) is not allowed' },
  { base: '192.88.99.0', prefix: 24, reason: 'Access to 6to4 relay anycast addresses (192.88.99.x) is not allowed' },
  { base: '192.168.0.0', prefix: 16, reason: 'Access to private network (192.168.x.x) is not allowed' },
  { base: '198.18.0.0', prefix: 15, reason: 'Access to benchmark addresses (198.18-19.x.x) is not allowed' },
  { base: '198.51.100.0', prefix: 24, reason: 'Access to documentation addresses (TEST-NET-2, 198.51.100.x) is not allowed' },
  { base: '203.0.113.0', prefix: 24, reason: 'Access to documentation addresses (TEST-NET-3, 203.0.113.x) is not allowed' },
  { base: '224.0.0.0', prefix: 4, reason: 'Access to multicast addresses (224-239.x.x.x) is not allowed' },
  { base: '240.0.0.0', prefix: 4, reason: 'Access to reserved/broadcast addresses (240-255.x.x.x) is not allowed' },
];

/** Parse a dotted-quad IPv4 address to an unsigned 32-bit integer. */
function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, octet) => ((acc << 8) | Number(octet)) >>> 0, 0);
}

function intToIpv4(n: number): string {
  return [n >>> 24, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff].join('.');
}

function inIpv4Range(ip: number, base: string, prefix: number): boolean {
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  return ((ip & mask) >>> 0) === ((ipv4ToInt(base) & mask) >>> 0);
}

/**
 * Parse an IPv6 address (any textual form, including an embedded dotted IPv4
 * tail or a zone index) into its eight 16-bit groups. Returns null if invalid.
 */
function parseIPv6(ip: string): number[] | null {
  let addr = ip.toLowerCase();
  const zone = addr.indexOf('%');
  if (zone !== -1) addr = addr.slice(0, zone);
  if (!isIPv6(addr)) return null;

  // Rewrite a dotted IPv4 tail (::ffff:1.2.3.4) as two hex groups.
  const lastColon = addr.lastIndexOf(':');
  const tail = addr.slice(lastColon + 1);
  if (tail.includes('.')) {
    const v4 = ipv4ToInt(tail);
    addr = `${addr.slice(0, lastColon + 1)}${(v4 >>> 16).toString(16)}:${(v4 & 0xffff).toString(16)}`;
  }

  const [head, rest] = addr.split('::');
  const headGroups = head ? head.split(':') : [];
  const restGroups = rest ? rest.split(':') : [];
  const fill = rest === undefined ? 0 : 8 - headGroups.length - restGroups.length;
  const groups = [...headGroups, ...Array<string>(fill).fill('0'), ...restGroups].map((g) => parseInt(g, 16));
  return groups.length === 8 ? groups : null;
}

/** Extract the IPv4 address carried in two 16-bit groups. */
function embeddedIpv4(high: number, low: number): string {
  return intToIpv4(((high << 16) | low) >>> 0);
}

/** Check if an IP is a loopback address (the only range `allowLocal` re-opens). */
function isLoopback(ip: string, family: 4 | 6): boolean {
  if (family === 4) {
    return isIPv4(ip) && ip.startsWith('127.');
  }
  const g = parseIPv6(ip);
  if (!g) return false;
  const upperZero = g.slice(0, 5).every((x) => x === 0);
  // ::1
  if (upperZero && g[5] === 0 && g[6] === 0 && g[7] === 1) return true;
  // ::ffff:127.0.0.0/104 — IPv4-mapped loopback connects to the real 127.x host
  return upperZero && g[5] === 0xffff && (g[6] >> 8) === 127;
}

/**
 * Check any IP address (IPv4 or IPv6) against the SSRF policy, applying the
 * `allowLocal` loopback exception. Fails closed on anything that is not a
 * valid IP address of the expected family.
 */
export function isBlockedIp(
  ip: string,
  options?: { allowLocal?: boolean; family?: 4 | 6 },
): IpCheckResult {
  const address = ip.startsWith('[') && ip.endsWith(']') ? ip.slice(1, -1) : ip;
  const detected = isIP(address.split('%')[0]);
  if (detected === 0 || (options?.family !== undefined && options.family !== detected)) {
    return { blocked: true, reason: `Not a valid IP address: ${ip}` };
  }
  const family = detected as 4 | 6;
  const result = family === 4 ? isBlockedIPv4(address) : isBlockedIPv6(address);
  if (result.blocked && options?.allowLocal && isLoopback(address, family)) {
    return { blocked: false };
  }
  return result;
}

/**
 * Check if an IPv4 address is outside public unicast space.
 * Returns not-blocked for strings that are not IPv4 addresses; use
 * {@link isBlockedIp} for a fail-closed check of arbitrary input.
 */
export function isBlockedIPv4(ip: string): IpCheckResult {
  if (!isIPv4(ip)) {
    return { blocked: false }; // Not an IPv4 address, check elsewhere
  }
  const n = ipv4ToInt(ip);
  const match = BLOCKED_IPV4_RANGES.find((r) => inIpv4Range(n, r.base, r.prefix));
  return match ? { blocked: true, reason: match.reason } : { blocked: false };
}

/** Re-check an IPv4 address embedded in an IPv6 address. */
function checkEmbeddedIpv4(kind: string, high: number, low: number): IpCheckResult {
  const v4 = embeddedIpv4(high, low);
  const check = isBlockedIPv4(v4);
  if (check.blocked) {
    return { blocked: true, reason: `Access to ${kind} blocked address (${v4}): ${check.reason}` };
  }
  return { blocked: false };
}

/**
 * Check if an IPv6 address is outside global unicast space.
 *
 * This is an allow-list: only 2000::/3 is accepted, minus its special-purpose
 * blocks. Formats that wrap an IPv4 address and are routed to it (IPv4-mapped,
 * NAT64 well-known prefix, 6to4) are unwrapped and the embedded address is
 * re-checked against the IPv4 policy.
 *
 * Returns not-blocked for strings that are not IPv6 addresses; use
 * {@link isBlockedIp} for a fail-closed check of arbitrary input.
 */
export function isBlockedIPv6(ip: string): IpCheckResult {
  const g = parseIPv6(ip);
  if (!g) {
    return { blocked: false }; // Not an IPv6 address, check elsewhere
  }

  // ::/96 family: unspecified, loopback, IPv4-compatible, IPv4-mapped
  if (g.slice(0, 5).every((x) => x === 0)) {
    if (g[5] === 0xffff) {
      return checkEmbeddedIpv4('IPv4-mapped', g[6], g[7]);
    }
    if (g[5] === 0) {
      if (g[6] === 0 && g[7] === 0) {
        return { blocked: true, reason: 'Access to the IPv6 unspecified address (::) is not allowed' };
      }
      if (g[6] === 0 && g[7] === 1) {
        return { blocked: true, reason: 'Access to IPv6 localhost is not allowed' };
      }
      return {
        blocked: true,
        reason: `Access to deprecated IPv4-compatible IPv6 addresses (::${embeddedIpv4(g[6], g[7])}) is not allowed`,
      };
    }
  }

  // 64:ff9b::/96 — NAT64 well-known prefix (RFC 6052); routed to the embedded IPv4
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) {
    return checkEmbeddedIpv4('NAT64', g[6], g[7]);
  }

  // Allow-list: anything outside 2000::/3 is not global unicast
  if ((g[0] & 0xe000) !== 0x2000) {
    if ((g[0] & 0xffc0) === 0xfe80) {
      return { blocked: true, reason: 'Access to IPv6 link-local addresses is not allowed' };
    }
    if ((g[0] & 0xfe00) === 0xfc00) {
      return { blocked: true, reason: 'Access to IPv6 private addresses is not allowed' };
    }
    if ((g[0] & 0xff00) === 0xff00) {
      return { blocked: true, reason: 'Access to IPv6 multicast addresses is not allowed' };
    }
    return { blocked: true, reason: 'Access to non-global-unicast IPv6 addresses is not allowed' };
  }

  // 2002::/16 — 6to4 (RFC 3056); routed to the embedded IPv4
  if (g[0] === 0x2002) {
    return checkEmbeddedIpv4('6to4', g[1], g[2]);
  }

  // 2001::/23 — IETF protocol assignments (Teredo, benchmarking, ORCHID, ...)
  if (g[0] === 0x2001 && g[1] < 0x0200) {
    return { blocked: true, reason: 'Access to IPv6 IETF protocol assignment addresses (2001::/23) is not allowed' };
  }

  // 2001:db8::/32 and 3fff::/20 — documentation (RFC 3849, RFC 9637)
  if ((g[0] === 0x2001 && g[1] === 0x0db8) || (g[0] === 0x3fff && g[1] < 0x1000)) {
    return { blocked: true, reason: 'Access to IPv6 documentation addresses is not allowed' };
  }

  // 5f00::/16 — SRv6 SIDs (RFC 9602), not globally reachable
  if (g[0] === 0x5f00) {
    return { blocked: true, reason: 'Access to IPv6 SRv6 SID addresses is not allowed' };
  }

  return { blocked: false };
}

/**
 * Validate a URL for SSRF prevention with DNS rebinding protection (SEC-001).
 * Returns resolvedIp and hostname on success to enable IP pinning.
 */
export async function validateUrl(
  urlString: string,
  options?: ValidateUrlOptions,
): Promise<UrlValidationResult> {
  const allowLocal = options?.allowLocal ?? false;
  const dnsResolver = options?.dnsResolver ?? defaultDnsResolver;
  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch {
    return { valid: false, error: 'Invalid URL format' };
  }

  // Only allow http and https protocols
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { valid: false, error: 'Only http and https protocols are allowed' };
  }

  const hostname = parsed.hostname.toLowerCase();

  // Block localhost by name (unless allowLocal is enabled)
  if (!allowLocal) {
    if (hostname === 'localhost' || hostname === 'localhost.localdomain') {
      return { valid: false, error: 'Access to localhost is not allowed' };
    }

    if (hostname === '[::1]') {
      return { valid: false, error: 'Access to IPv6 localhost is not allowed' };
    }
  }

  // Check if hostname is a literal IP address
  const isLiteralIPv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(hostname);
  const isLiteralIPv6 = hostname.startsWith('[') && hostname.endsWith(']');

  if (isLiteralIPv4) {
    // Direct IPv4 - validate immediately
    const ipCheck = isBlockedIp(hostname, { allowLocal, family: 4 });
    if (ipCheck.blocked) {
      return { valid: false, error: ipCheck.reason };
    }
    return { valid: true, resolvedIp: hostname, hostname };
  }

  if (isLiteralIPv6) {
    // Direct IPv6 - validate immediately (strip brackets)
    const ipv6 = hostname.slice(1, -1);
    const ipCheck = isBlockedIp(ipv6, { allowLocal, family: 6 });
    if (ipCheck.blocked) {
      return { valid: false, error: ipCheck.reason };
    }
    return { valid: true, resolvedIp: ipv6, hostname };
  }

  // Hostname provided - resolve DNS to get actual IP addresses
  // This prevents DNS rebinding attacks (SEC-001)
  try {
    // Resolve all A and AAAA records
    const addresses = await dnsResolver.lookup(hostname, { all: true });

    if (addresses.length === 0) {
      return { valid: false, error: 'DNS resolution returned no addresses' };
    }

    // Check ALL resolved IPs - if any is blocked, reject the entire request
    let firstNonBlockedIp: string | undefined;
    for (const addr of addresses) {
      if (addr.family === 4 || addr.family === 6) {
        const ipCheck = isBlockedIp(addr.address, { allowLocal, family: addr.family });
        if (ipCheck.blocked) {
          return { valid: false, error: `DNS resolved to blocked IP: ${ipCheck.reason}` };
        }
        if (!firstNonBlockedIp) firstNonBlockedIp = addr.address;
      }
    }

    if (!firstNonBlockedIp) {
      // Nothing to pin Chromium to — fail closed rather than let it resolve freely
      return { valid: false, error: 'DNS resolution returned no usable IPv4/IPv6 addresses' };
    }

    return { valid: true, resolvedIp: firstNonBlockedIp, hostname };
  } catch (dnsError) {
    // DNS resolution failed - could be NXDOMAIN, timeout, or network error
    // Fail closed: reject requests we cannot validate
    const errorMessage = dnsError instanceof Error ? dnsError.message : String(dnsError);
    return { valid: false, error: `DNS resolution failed: ${errorMessage}` };
  }
}
