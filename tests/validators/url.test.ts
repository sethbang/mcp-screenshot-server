import { describe, it, expect } from 'vitest';
import { validateUrl, isBlockedIp, isBlockedIPv4, isBlockedIPv6 } from '../../src/validators/url.js';
import { createMockDns, mockDns } from '../mocks/dns.js';

describe('isBlockedIPv4', () => {
  it('blocks loopback 127.x.x.x', () => {
    expect(isBlockedIPv4('127.0.0.1').blocked).toBe(true);
    expect(isBlockedIPv4('127.255.255.255').blocked).toBe(true);
  });

  it('blocks 10.x.x.x private range', () => {
    expect(isBlockedIPv4('10.0.0.1').blocked).toBe(true);
    expect(isBlockedIPv4('10.255.255.255').blocked).toBe(true);
  });

  it('blocks 172.16-31.x.x private range', () => {
    expect(isBlockedIPv4('172.16.0.1').blocked).toBe(true);
    expect(isBlockedIPv4('172.31.255.255').blocked).toBe(true);
    expect(isBlockedIPv4('172.15.0.1').blocked).toBe(false);
    expect(isBlockedIPv4('172.32.0.1').blocked).toBe(false);
  });

  it('blocks 192.168.x.x private range', () => {
    expect(isBlockedIPv4('192.168.0.1').blocked).toBe(true);
    expect(isBlockedIPv4('192.168.255.255').blocked).toBe(true);
  });

  it('blocks 169.254.x.x link-local/metadata', () => {
    expect(isBlockedIPv4('169.254.169.254').blocked).toBe(true);
    expect(isBlockedIPv4('169.254.0.1').blocked).toBe(true);
  });

  it('blocks 0.x.x.x', () => {
    expect(isBlockedIPv4('0.0.0.0').blocked).toBe(true);
  });

  it('blocks 100.64.0.0/10 CGNAT range', () => {
    expect(isBlockedIPv4('100.64.0.1').blocked).toBe(true);
    expect(isBlockedIPv4('100.100.0.1').blocked).toBe(true);
    expect(isBlockedIPv4('100.127.255.255').blocked).toBe(true);
    expect(isBlockedIPv4('100.63.255.255').blocked).toBe(false);
    expect(isBlockedIPv4('100.128.0.1').blocked).toBe(false);
  });

  it('blocks 198.18.0.0/15 benchmark range', () => {
    expect(isBlockedIPv4('198.18.0.1').blocked).toBe(true);
    expect(isBlockedIPv4('198.19.255.255').blocked).toBe(true);
    expect(isBlockedIPv4('198.17.0.1').blocked).toBe(false);
    expect(isBlockedIPv4('198.20.0.1').blocked).toBe(false);
  });

  it('blocks broadcast 255.255.255.255', () => {
    expect(isBlockedIPv4('255.255.255.255').blocked).toBe(true);
    // The rest of 240.0.0.0/4 is reserved and blocked too
    expect(isBlockedIPv4('255.255.255.254').blocked).toBe(true);
  });

  it('blocks 224.0.0.0/4 multicast', () => {
    expect(isBlockedIPv4('224.0.0.1').blocked).toBe(true);
    expect(isBlockedIPv4('239.255.255.250').blocked).toBe(true);
    expect(isBlockedIPv4('223.255.255.255').blocked).toBe(false);
  });

  it('blocks 240.0.0.0/4 reserved', () => {
    expect(isBlockedIPv4('240.0.0.1').blocked).toBe(true);
    expect(isBlockedIPv4('250.1.2.3').blocked).toBe(true);
  });

  it('blocks 192.0.0.0/24 IETF protocol assignments', () => {
    expect(isBlockedIPv4('192.0.0.1').blocked).toBe(true);
    expect(isBlockedIPv4('192.0.0.170').blocked).toBe(true);
    expect(isBlockedIPv4('192.0.1.1').blocked).toBe(false);
  });

  it('blocks TEST-NET documentation ranges', () => {
    expect(isBlockedIPv4('192.0.2.1').blocked).toBe(true);
    expect(isBlockedIPv4('198.51.100.1').blocked).toBe(true);
    expect(isBlockedIPv4('203.0.113.1').blocked).toBe(true);
    expect(isBlockedIPv4('192.0.3.1').blocked).toBe(false);
    expect(isBlockedIPv4('198.51.101.1').blocked).toBe(false);
    expect(isBlockedIPv4('203.0.114.1').blocked).toBe(false);
  });

  it('blocks 192.88.99.0/24 6to4 relay anycast', () => {
    expect(isBlockedIPv4('192.88.99.1').blocked).toBe(true);
  });

  it('allows public IPs', () => {
    expect(isBlockedIPv4('93.184.216.34').blocked).toBe(false);
    expect(isBlockedIPv4('8.8.8.8').blocked).toBe(false);
    expect(isBlockedIPv4('1.1.1.1').blocked).toBe(false);
    expect(isBlockedIPv4('223.5.5.5').blocked).toBe(false);
  });

  it('returns not blocked for non-IPv4 strings', () => {
    expect(isBlockedIPv4('not-an-ip').blocked).toBe(false);
  });
});

describe('isBlockedIPv6', () => {
  it('blocks ::1 loopback', () => {
    expect(isBlockedIPv6('::1').blocked).toBe(true);
  });

  it('blocks fe80:: link-local', () => {
    expect(isBlockedIPv6('fe80::1').blocked).toBe(true);
  });

  it('blocks fc00::/fd00:: unique local', () => {
    expect(isBlockedIPv6('fc00::1').blocked).toBe(true);
    expect(isBlockedIPv6('fd12::1').blocked).toBe(true);
  });

  it('blocks IPv4-mapped IPv6 with blocked IPv4 (dotted form)', () => {
    expect(isBlockedIPv6('::ffff:127.0.0.1').blocked).toBe(true);
    expect(isBlockedIPv6('::ffff:10.0.0.1').blocked).toBe(true);
  });

  it('blocks IPv4-mapped IPv6 with blocked IPv4 (hex form)', () => {
    // ::ffff:7f00:1 = ::ffff:127.0.0.1 (loopback)
    expect(isBlockedIPv6('::ffff:7f00:1').blocked).toBe(true);
    // ::ffff:a00:1 = ::ffff:10.0.0.1 (private)
    expect(isBlockedIPv6('::ffff:a00:1').blocked).toBe(true);
    // ::ffff:c0a8:101 = ::ffff:192.168.1.1 (private)
    expect(isBlockedIPv6('::ffff:c0a8:101').blocked).toBe(true);
    // ::ffff:a9fe:a9fe = ::ffff:169.254.169.254 (metadata)
    expect(isBlockedIPv6('::ffff:a9fe:a9fe').blocked).toBe(true);
    // ::ffff:6440:1 = ::ffff:100.64.0.1 (CGNAT)
    expect(isBlockedIPv6('::ffff:6440:1').blocked).toBe(true);
  });

  it('allows IPv4-mapped IPv6 with public IPv4 (dotted form)', () => {
    expect(isBlockedIPv6('::ffff:93.184.216.34').blocked).toBe(false);
  });

  it('allows IPv4-mapped IPv6 with public IPv4 (hex form)', () => {
    // ::ffff:5db8:d822 = ::ffff:93.184.216.34
    expect(isBlockedIPv6('::ffff:5db8:d822').blocked).toBe(false);
  });

  it('blocks :: unspecified address', () => {
    expect(isBlockedIPv6('::').blocked).toBe(true);
    expect(isBlockedIPv6('0:0:0:0:0:0:0:0').blocked).toBe(true);
  });

  it('blocks IPv4-compatible ::/96 addresses', () => {
    // ::127.0.0.1 is normalized to ::7f00:1 by the URL parser
    expect(isBlockedIPv6('::7f00:1').blocked).toBe(true);
    expect(isBlockedIPv6('::127.0.0.1').blocked).toBe(true);
    // Deprecated format: blocked even when the embedded address is public
    expect(isBlockedIPv6('::808:808').blocked).toBe(true);
  });

  it('blocks NAT64 64:ff9b::/96 wrapping a blocked IPv4 address', () => {
    const result = isBlockedIPv6('64:ff9b::a9fe:a9fe');
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain('NAT64');
    expect(result.reason).toContain('169.254.169.254');
    expect(isBlockedIPv6('64:ff9b::169.254.169.254').blocked).toBe(true);
    expect(isBlockedIPv6('64:ff9b::7f00:1').blocked).toBe(true);
    expect(isBlockedIPv6('64:ff9b::a00:1').blocked).toBe(true);
  });

  it('allows NAT64 64:ff9b::/96 wrapping a public IPv4 address', () => {
    // DNS64 synthesizes these for IPv4-only hosts on NAT64 networks
    expect(isBlockedIPv6('64:ff9b::808:808').blocked).toBe(false);
  });

  it('blocks 64:ff9b:1::/48 local-use NAT64', () => {
    expect(isBlockedIPv6('64:ff9b:1::808:808').blocked).toBe(true);
  });

  it('blocks 6to4 2002::/16 wrapping a blocked IPv4 address', () => {
    const result = isBlockedIPv6('2002:a9fe:a9fe::');
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain('6to4');
    expect(isBlockedIPv6('2002:7f00:1::1').blocked).toBe(true);
    expect(isBlockedIPv6('2002:c0a8:101::1').blocked).toBe(true);
  });

  it('allows 6to4 2002::/16 wrapping a public IPv4 address', () => {
    expect(isBlockedIPv6('2002:808:808::1').blocked).toBe(false);
  });

  it('blocks IPv6 multicast and other non-global-unicast space', () => {
    expect(isBlockedIPv6('ff02::1').blocked).toBe(true);
    expect(isBlockedIPv6('100::1').blocked).toBe(true);
    expect(isBlockedIPv6('fec0::1').blocked).toBe(true);
    expect(isBlockedIPv6('4000::1').blocked).toBe(true);
  });

  it('blocks special-purpose blocks inside 2000::/3', () => {
    expect(isBlockedIPv6('2001::1').blocked).toBe(true); // Teredo
    expect(isBlockedIPv6('2001:2::1').blocked).toBe(true); // benchmarking
    expect(isBlockedIPv6('2001:20::1').blocked).toBe(true); // ORCHIDv2
    expect(isBlockedIPv6('2001:db8::1').blocked).toBe(true); // documentation
    expect(isBlockedIPv6('3fff::1').blocked).toBe(true); // documentation
    expect(isBlockedIPv6('5f00::1').blocked).toBe(true); // SRv6 SIDs
  });

  it('allows public IPv6', () => {
    expect(isBlockedIPv6('2606:4700:4700::1111').blocked).toBe(false);
    expect(isBlockedIPv6('2001:4860:4860::8888').blocked).toBe(false);
    expect(isBlockedIPv6('2a00:1450:4001:80b::200e').blocked).toBe(false);
  });

  it('returns not blocked for non-IPv6 strings', () => {
    expect(isBlockedIPv6('not-an-ip').blocked).toBe(false);
    expect(isBlockedIPv6('8.8.8.8').blocked).toBe(false);
  });
});

describe('isBlockedIp', () => {
  it('checks both families', () => {
    expect(isBlockedIp('10.0.0.1').blocked).toBe(true);
    expect(isBlockedIp('fe80::1').blocked).toBe(true);
    expect(isBlockedIp('8.8.8.8').blocked).toBe(false);
    expect(isBlockedIp('2606:4700:4700::1111').blocked).toBe(false);
  });

  it('accepts bracketed IPv6 as reported by Chromium', () => {
    expect(isBlockedIp('[::1]').blocked).toBe(true);
    expect(isBlockedIp('[2606:4700:4700::1111]').blocked).toBe(false);
  });

  it('fails closed on invalid input or a family mismatch', () => {
    expect(isBlockedIp('not-an-ip').blocked).toBe(true);
    expect(isBlockedIp('').blocked).toBe(true);
    expect(isBlockedIp('8.8.8.8', { family: 6 }).blocked).toBe(true);
  });

  it('applies the allowLocal loopback exception only to loopback', () => {
    expect(isBlockedIp('127.0.0.1', { allowLocal: true }).blocked).toBe(false);
    expect(isBlockedIp('::1', { allowLocal: true }).blocked).toBe(false);
    expect(isBlockedIp('::ffff:7f00:1', { allowLocal: true }).blocked).toBe(false);
    expect(isBlockedIp('::', { allowLocal: true }).blocked).toBe(true);
    expect(isBlockedIp('0.0.0.0', { allowLocal: true }).blocked).toBe(true);
    expect(isBlockedIp('::7f00:1', { allowLocal: true }).blocked).toBe(true);
    expect(isBlockedIp('64:ff9b::7f00:1', { allowLocal: true }).blocked).toBe(true);
    expect(isBlockedIp('2002:7f00:1::', { allowLocal: true }).blocked).toBe(true);
  });
});

describe('validateUrl', () => {
  it('accepts a valid public URL', async () => {
    const result = await validateUrl('https://example.com', { dnsResolver: mockDns.public });
    expect(result).toEqual({
      valid: true,
      resolvedIp: '93.184.216.34',
      hostname: 'example.com',
    });
  });

  it('rejects URL resolving to localhost', async () => {
    const result = await validateUrl('https://evil.com', { dnsResolver: mockDns.localhost });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('blocked IP');
  });

  it('rejects NXDOMAIN', async () => {
    const result = await validateUrl('https://nonexistent.example', { dnsResolver: mockDns.nxdomain });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('DNS resolution failed');
  });

  it('rejects DNS timeout', async () => {
    const result = await validateUrl('https://example.com', { dnsResolver: mockDns.timeout });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('DNS resolution failed');
  });

  it('rejects invalid URL format', async () => {
    const result = await validateUrl('not-a-url');
    expect(result).toEqual({ valid: false, error: 'Invalid URL format' });
  });

  it('rejects ftp:// protocol', async () => {
    const result = await validateUrl('ftp://example.com/file');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Only http and https');
  });

  it('rejects file:// protocol', async () => {
    const result = await validateUrl('file:///etc/passwd');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Only http and https');
  });

  it('rejects localhost by name', async () => {
    const result = await validateUrl('http://localhost:8080');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('localhost');
  });

  it('rejects localhost.localdomain', async () => {
    const result = await validateUrl('http://localhost.localdomain');
    expect(result.valid).toBe(false);
  });

  it('rejects direct private IPv4', async () => {
    const result = await validateUrl('http://192.168.1.1');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('private network');
  });

  it('accepts direct public IPv4', async () => {
    const result = await validateUrl('http://93.184.216.34');
    expect(result.valid).toBe(true);
    expect(result.resolvedIp).toBe('93.184.216.34');
    expect(result.hostname).toBe('93.184.216.34');
  });

  it('rejects IPv6 loopback in brackets', async () => {
    const result = await validateUrl('http://[::1]:8080');
    expect(result.valid).toBe(false);
  });

  it('returns hostname for DNS-resolved URLs', async () => {
    const dns = createMockDns(new Map([
      ['mysite.org', [{ address: '1.2.3.4', family: 4 }]],
    ]));
    const result = await validateUrl('https://mysite.org/page', { dnsResolver: dns });
    expect(result.valid).toBe(true);
    expect(result.resolvedIp).toBe('1.2.3.4');
    expect(result.hostname).toBe('mysite.org');
  });

  it('rejects when all DNS results are blocked', async () => {
    const dns = createMockDns(new Map([
      ['internal.corp', [
        { address: '10.0.0.5', family: 4 },
        { address: '10.0.0.6', family: 4 },
      ]],
    ]));
    const result = await validateUrl('https://internal.corp', { dnsResolver: dns });
    expect(result.valid).toBe(false);
  });

  it('rejects when any DNS result is blocked', async () => {
    const dns = createMockDns(new Map([
      ['mixed.example', [
        { address: '93.184.216.34', family: 4 },
        { address: '127.0.0.1', family: 4 },
      ]],
    ]));
    const result = await validateUrl('https://mixed.example', { dnsResolver: dns });
    expect(result.valid).toBe(false);
  });
});

describe('validateUrl — non-public address forms', () => {
  const blockedIPv4 = [
    '224.0.0.1', // multicast
    '239.255.255.250', // multicast (SSDP)
    '240.0.0.1', // reserved
    '255.255.255.255', // broadcast
    '192.0.0.8', // IETF protocol assignments
    '192.0.2.1', // TEST-NET-1
    '198.51.100.1', // TEST-NET-2
    '203.0.113.1', // TEST-NET-3
  ];
  const blockedIPv6 = [
    '::', // unspecified
    '::127.0.0.1', // IPv4-compatible
    '64:ff9b::a9fe:a9fe', // NAT64 → 169.254.169.254
    '64:ff9b::169.254.169.254', // NAT64, dotted form
    '2002:a9fe:a9fe::', // 6to4 → 169.254.169.254
    '::ffff:169.254.169.254', // IPv4-mapped
    'ff02::1', // multicast
    '2001:db8::1', // documentation
  ];
  const publicIPv4 = ['8.8.8.8', '1.1.1.1', '93.184.216.34'];
  const publicIPv6 = ['2606:4700:4700::1111', '64:ff9b::808:808', '2002:808:808::1'];

  it.each(blockedIPv4)('rejects literal %s', async (ip) => {
    const result = await validateUrl(`http://${ip}/`);
    expect(result.valid).toBe(false);
  });

  it.each(blockedIPv6)('rejects literal [%s]', async (ip) => {
    const result = await validateUrl(`http://[${ip}]:8080/`);
    expect(result.valid).toBe(false);
  });

  it.each(publicIPv4)('accepts literal %s', async (ip) => {
    const result = await validateUrl(`http://${ip}/`);
    expect(result).toEqual({ valid: true, resolvedIp: ip, hostname: ip });
  });

  it.each(publicIPv6)('accepts literal [%s]', async (ip) => {
    const result = await validateUrl(`http://[${ip}]/`);
    expect(result.valid).toBe(true);
  });

  it.each(blockedIPv4)('rejects a hostname resolving to %s', async (ip) => {
    const dns = createMockDns(new Map([['rebind.example', [{ address: ip, family: 4 }]]]));
    const result = await validateUrl('https://rebind.example', { dnsResolver: dns });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('blocked IP');
  });

  it.each(blockedIPv6)('rejects a hostname resolving to %s', async (ip) => {
    const dns = createMockDns(new Map([['rebind.example', [{ address: ip, family: 6 }]]]));
    const result = await validateUrl('https://rebind.example', { dnsResolver: dns });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('blocked IP');
  });

  it.each(publicIPv4)('accepts a hostname resolving to %s', async (ip) => {
    const dns = createMockDns(new Map([['public.example', [{ address: ip, family: 4 }]]]));
    const result = await validateUrl('https://public.example', { dnsResolver: dns });
    expect(result).toEqual({ valid: true, resolvedIp: ip, hostname: 'public.example' });
  });

  it.each(publicIPv6)('accepts a hostname resolving to %s', async (ip) => {
    const dns = createMockDns(new Map([['public.example', [{ address: ip, family: 6 }]]]));
    const result = await validateUrl('https://public.example', { dnsResolver: dns });
    expect(result).toEqual({ valid: true, resolvedIp: ip, hostname: 'public.example' });
  });

  it('rejects a mixed public/NAT64-wrapped-metadata answer', async () => {
    const dns = createMockDns(new Map([
      ['mixed.example', [
        { address: '93.184.216.34', family: 4 },
        { address: '64:ff9b::a9fe:a9fe', family: 6 },
      ]],
    ]));
    const result = await validateUrl('https://mixed.example', { dnsResolver: dns });
    expect(result.valid).toBe(false);
  });

  it('rejects a resolver answer whose address does not match its family', async () => {
    const dns = createMockDns(new Map([['odd.example', [{ address: '::1', family: 4 }]]]));
    const result = await validateUrl('https://odd.example', { dnsResolver: dns });
    expect(result.valid).toBe(false);
  });
});

describe('validateUrl with allowLocal', () => {
  it('allows localhost:3000 when allowLocal is true', async () => {
    const result = await validateUrl('http://localhost:3000', {
      allowLocal: true,
      dnsResolver: mockDns.localhostReal,
    });
    expect(result.valid).toBe(true);
    expect(result.resolvedIp).toBe('127.0.0.1');
    expect(result.hostname).toBe('localhost');
  });

  it('allows localhost.localdomain when allowLocal is true', async () => {
    const result = await validateUrl('http://localhost.localdomain', {
      allowLocal: true,
      dnsResolver: mockDns.localhostReal,
    });
    expect(result.valid).toBe(true);
    expect(result.resolvedIp).toBe('127.0.0.1');
  });

  it('allows direct 127.0.0.1 when allowLocal is true', async () => {
    const result = await validateUrl('http://127.0.0.1:5173', { allowLocal: true });
    expect(result.valid).toBe(true);
    expect(result.resolvedIp).toBe('127.0.0.1');
  });

  it('allows other 127.x addresses when allowLocal is true', async () => {
    const result = await validateUrl('http://127.99.99.99', { allowLocal: true });
    expect(result.valid).toBe(true);
    expect(result.resolvedIp).toBe('127.99.99.99');
  });

  it('allows [::1] when allowLocal is true', async () => {
    const result = await validateUrl('http://[::1]:8080', { allowLocal: true });
    expect(result.valid).toBe(true);
    expect(result.resolvedIp).toBe('::1');
  });

  it('still blocks private IPs when allowLocal is true', async () => {
    expect((await validateUrl('http://192.168.1.1', { allowLocal: true })).valid).toBe(false);
    expect((await validateUrl('http://10.0.0.1', { allowLocal: true })).valid).toBe(false);
    expect((await validateUrl('http://172.16.0.1', { allowLocal: true })).valid).toBe(false);
  });

  it('still blocks cloud metadata when allowLocal is true', async () => {
    const result = await validateUrl('http://169.254.169.254', { allowLocal: true });
    expect(result.valid).toBe(false);
  });

  it('allows IPv4-mapped loopback when allowLocal is true', async () => {
    const result = await validateUrl('http://[::ffff:127.0.0.1]:3000', { allowLocal: true });
    expect(result.valid).toBe(true);
  });

  it('still blocks the unspecified addresses when allowLocal is true', async () => {
    expect((await validateUrl('http://[::]:8080', { allowLocal: true })).valid).toBe(false);
    expect((await validateUrl('http://0.0.0.0:8080', { allowLocal: true })).valid).toBe(false);
  });

  it('still blocks wrapped loopback forms when allowLocal is true', async () => {
    expect((await validateUrl('http://[::127.0.0.1]', { allowLocal: true })).valid).toBe(false);
    expect((await validateUrl('http://[64:ff9b::7f00:1]', { allowLocal: true })).valid).toBe(false);
    expect((await validateUrl('http://[2002:7f00:1::]', { allowLocal: true })).valid).toBe(false);
  });

  it('still blocks CGNAT when allowLocal is true', async () => {
    const result = await validateUrl('http://100.64.0.1', { allowLocal: true });
    expect(result.valid).toBe(false);
  });

  it('allows DNS resolving to loopback when allowLocal is true', async () => {
    const result = await validateUrl('https://evil.com', {
      allowLocal: true,
      dnsResolver: mockDns.localhost,
    });
    expect(result.valid).toBe(true);
    expect(result.resolvedIp).toBe('127.0.0.1');
  });

  it('still blocks DNS resolving to private IP when allowLocal is true', async () => {
    const dns = createMockDns(new Map([
      ['internal.corp', [{ address: '10.0.0.5', family: 4 }]],
    ]));
    const result = await validateUrl('https://internal.corp', {
      allowLocal: true,
      dnsResolver: dns,
    });
    expect(result.valid).toBe(false);
  });

  it('blocks mixed DNS results with loopback + private when allowLocal is true', async () => {
    const dns = createMockDns(new Map([
      ['mixed.example', [
        { address: '127.0.0.1', family: 4 },
        { address: '10.0.0.1', family: 4 },
      ]],
    ]));
    const result = await validateUrl('https://mixed.example', {
      allowLocal: true,
      dnsResolver: dns,
    });
    expect(result.valid).toBe(false);
  });
});
