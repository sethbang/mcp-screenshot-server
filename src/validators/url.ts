import { promises as dns } from 'dns';
import type { LookupAddress } from 'dns';
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

/** Check if an IP is a loopback address. */
function isLoopback(ip: string, family: 4 | 6): boolean {
  if (family === 4) {
    return /^127\./.test(ip);
  }
  const normalized = ip.toLowerCase();
  if (normalized === '::1') return true;
  // ::ffff:127.x.x.x (dotted form)
  if (/^::ffff:127\./.test(normalized)) return true;
  // ::ffff:7f00:0 through ::ffff:7fff:ffff (hex form for 127.0.0.0/8)
  const hexMatch = normalized.match(/^::ffff:([0-9a-f]{1,4}):[0-9a-f]{1,4}$/);
  if (hexMatch) {
    const high = parseInt(hexMatch[1], 16);
    if ((high >> 8) === 127) return true;
  }
  return false;
}

/** Wrapper that applies the allowLocal policy over isBlockedIPv4/isBlockedIPv6. */
function shouldBlockIp(
  ip: string,
  family: 4 | 6,
  allowLocal: boolean,
): { blocked: boolean; reason?: string } {
  const result = family === 4 ? isBlockedIPv4(ip) : isBlockedIPv6(ip);
  if (result.blocked && allowLocal && isLoopback(ip, family)) {
    return { blocked: false };
  }
  return result;
}

/** Check if an IPv4 address is in a blocked range. */
export function isBlockedIPv4(ip: string): { blocked: boolean; reason?: string } {
  const ipv4Match = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4Match) {
    return { blocked: false }; // Not an IPv4 address, check elsewhere
  }

  const [, a, b, c, d] = ipv4Match.map(Number);

  // Block loopback: 127.0.0.0/8
  if (a === 127) {
    return { blocked: true, reason: 'Access to loopback addresses is not allowed' };
  }

  // Block private: 10.0.0.0/8
  if (a === 10) {
    return { blocked: true, reason: 'Access to private network (10.x.x.x) is not allowed' };
  }

  // Block private: 172.16.0.0/12 (172.16.x.x - 172.31.x.x)
  if (a === 172 && b >= 16 && b <= 31) {
    return { blocked: true, reason: 'Access to private network (172.16-31.x.x) is not allowed' };
  }

  // Block private: 192.168.0.0/16
  if (a === 192 && b === 168) {
    return { blocked: true, reason: 'Access to private network (192.168.x.x) is not allowed' };
  }

  // Block link-local and cloud metadata: 169.254.0.0/16
  if (a === 169 && b === 254) {
    return { blocked: true, reason: 'Access to link-local/metadata addresses (169.254.x.x) is not allowed' };
  }

  // Block 0.0.0.0/8
  if (a === 0) {
    return { blocked: true, reason: 'Access to 0.x.x.x addresses is not allowed' };
  }

  // Block CGNAT / Shared Address Space: 100.64.0.0/10 (100.64.x.x - 100.127.x.x)
  // Used by AWS VPC, Tailscale, carrier-grade NAT
  if (a === 100 && b >= 64 && b <= 127) {
    return { blocked: true, reason: 'Access to shared/CGNAT addresses (100.64-127.x.x) is not allowed' };
  }

  // Block benchmark testing: 198.18.0.0/15 (198.18.x.x - 198.19.x.x)
  if (a === 198 && (b === 18 || b === 19)) {
    return { blocked: true, reason: 'Access to benchmark addresses (198.18-19.x.x) is not allowed' };
  }

  // Block broadcast: 255.255.255.255
  if (a === 255 && b === 255 && c === 255 && d === 255) {
    return { blocked: true, reason: 'Access to broadcast address is not allowed' };
  }

  return { blocked: false };
}

/** Check if an IPv6 address is blocked (localhost, link-local, etc.). */
export function isBlockedIPv6(ip: string): { blocked: boolean; reason?: string } {
  const normalized = ip.toLowerCase();

  // Block IPv6 loopback
  if (normalized === '::1') {
    return { blocked: true, reason: 'Access to IPv6 localhost is not allowed' };
  }

  // Block IPv6 link-local (fe80::/10)
  // fe80::/10 means the first 10 bits are 1111111010, covering fe80:: through febf::
  // We parse the first 16-bit group and check (group & 0xFFC0) === 0xFE80
  const firstGroup = normalized.split(':')[0];
  if (firstGroup) {
    const groupValue = parseInt(firstGroup, 16);
    if (!isNaN(groupValue) && (groupValue & 0xffc0) === 0xfe80) {
      return { blocked: true, reason: 'Access to IPv6 link-local addresses is not allowed' };
    }
  }

  // Block IPv6 unique local (fc00::/7 = fc00:: to fdff::)
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) {
    return { blocked: true, reason: 'Access to IPv6 private addresses is not allowed' };
  }

  // Block IPv4-mapped IPv6 addresses in dotted-decimal form (::ffff:x.x.x.x)
  const ipv4MappedMatch = normalized.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (ipv4MappedMatch) {
    const ipv4Check = isBlockedIPv4(ipv4MappedMatch[1]);
    if (ipv4Check.blocked) {
      return { blocked: true, reason: `Access to IPv4-mapped blocked address: ${ipv4Check.reason}` };
    }
  }

  // Block IPv4-mapped IPv6 addresses in hex form (::ffff:HHHH:HHHH)
  // Node.js URL parser normalizes ::ffff:127.0.0.1 to ::ffff:7f00:1
  const ipv4MappedHexMatch = normalized.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (ipv4MappedHexMatch) {
    const high = parseInt(ipv4MappedHexMatch[1], 16);
    const low = parseInt(ipv4MappedHexMatch[2], 16);
    const a = (high >> 8) & 0xff;
    const b = high & 0xff;
    const c = (low >> 8) & 0xff;
    const d = low & 0xff;
    const ipv4 = `${a}.${b}.${c}.${d}`;
    const ipv4Check = isBlockedIPv4(ipv4);
    if (ipv4Check.blocked) {
      return { blocked: true, reason: `Access to IPv4-mapped blocked address: ${ipv4Check.reason}` };
    }
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
    const ipCheck = shouldBlockIp(hostname, 4, allowLocal);
    if (ipCheck.blocked) {
      return { valid: false, error: ipCheck.reason };
    }
    return { valid: true, resolvedIp: hostname, hostname };
  }

  if (isLiteralIPv6) {
    // Direct IPv6 - validate immediately (strip brackets)
    const ipv6 = hostname.slice(1, -1);
    const ipCheck = shouldBlockIp(ipv6, 6, allowLocal);
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
        const ipCheck = shouldBlockIp(addr.address, addr.family, allowLocal);
        if (ipCheck.blocked) {
          return { valid: false, error: `DNS resolved to blocked IP: ${ipCheck.reason}` };
        }
        if (!firstNonBlockedIp) firstNonBlockedIp = addr.address;
      }
    }

    return { valid: true, resolvedIp: firstNonBlockedIp, hostname };
  } catch (dnsError) {
    // DNS resolution failed - could be NXDOMAIN, timeout, or network error
    // Fail closed: reject requests we cannot validate
    const errorMessage = dnsError instanceof Error ? dnsError.message : String(dnsError);
    return { valid: false, error: `DNS resolution failed: ${errorMessage}` };
  }
}
