import type { LookupAddress } from 'dns';
import type { DnsResolver } from '../../src/validators/url.js';

export function createMockDns(responses: Map<string, LookupAddress[]>): DnsResolver {
  return {
    async lookup(hostname) {
      const result = responses.get(hostname);
      if (!result) {
        const err = new Error(`getaddrinfo ENOTFOUND ${hostname}`);
        (err as NodeJS.ErrnoException).code = 'ENOTFOUND';
        throw err;
      }
      return result;
    }
  };
}

export const mockDns = {
  localhost: createMockDns(new Map([['evil.com', [{ address: '127.0.0.1', family: 4 }]]])),
  localhostReal: createMockDns(new Map([
    ['localhost', [{ address: '127.0.0.1', family: 4 }]],
    ['localhost.localdomain', [{ address: '127.0.0.1', family: 4 }]],
  ])),
  public: createMockDns(new Map([['example.com', [{ address: '93.184.216.34', family: 4 }]]])),
  nxdomain: createMockDns(new Map()),
  timeout: {
    async lookup() {
      const err = new Error('queryA ETIMEOUT example.com');
      (err as NodeJS.ErrnoException).code = 'ETIMEOUT';
      throw err;
    }
  } as DnsResolver,
};
