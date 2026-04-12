import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock config/runtime before imports
const mockSemaphore = {
  tryAcquire: vi.fn().mockReturnValue(true),
  release: vi.fn(),
};

vi.mock('../../src/config/runtime.js', () => ({
  defaultOutDir: '/home/user/Desktop/Screenshots',
  ensureDefaultDirectory: vi.fn(),
  puppeteerSemaphore: {
    tryAcquire: (...args: unknown[]) => mockSemaphore.tryAcquire(...args),
    release: (...args: unknown[]) => mockSemaphore.release(...args),
  },
}));

vi.mock('../../src/config/index.js', () => ({
  ALLOWED_OUTPUT_DIRS: ['/home/user/Desktop/Screenshots', '/tmp'],
  MAX_CONCURRENT_SCREENSHOTS: 3,
  ALLOW_LOCAL: false,
}));

vi.mock('../../src/validators/url.js', () => ({
  validateUrl: vi.fn(),
}));

vi.mock('../../src/validators/path.js', () => ({
  validateOutputPath: vi.fn(),
}));

vi.mock('../../src/utils/helpers.js', () => ({
  ok: (text: string) => ({ content: [{ type: 'text', text }] }),
  err: (text: string) => ({ content: [{ type: 'text', text }], isError: true }),
  timestamp: () => '2024-01-01T00-00-00-000Z',
  ensureDir: vi.fn(),
}));

// Create mock page and browser
const mockPage = {
  setViewport: vi.fn(),
  setRequestInterception: vi.fn(),
  on: vi.fn(),
  goto: vi.fn(),
  waitForSelector: vi.fn(),
  $: vi.fn(),
  screenshot: vi.fn(),
};

const mockBrowser = {
  newPage: vi.fn().mockResolvedValue(mockPage),
  close: vi.fn(),
};

vi.mock('puppeteer', () => ({
  default: {
    launch: vi.fn().mockResolvedValue({
      newPage: () => mockBrowser.newPage(),
      close: () => mockBrowser.close(),
    }),
  },
}));

import puppeteer from 'puppeteer';
import { validateUrl } from '../../src/validators/url.js';
import { validateOutputPath } from '../../src/validators/path.js';

const mockLaunch = vi.mocked(puppeteer.launch);
const mockValidateUrl = vi.mocked(validateUrl);
const mockValidateOutputPath = vi.mocked(validateOutputPath);

// Capture the handler via McpServer mock
let capturedHandler: Function;

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: class {
    registerTool(_name: string, _schema: unknown, handler: Function) {
      capturedHandler = handler;
    }
  },
}));

import { registerTakeScreenshot } from '../../src/tools/take-screenshot.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const server = new McpServer({ name: 'test', version: '1.0.0' } as any);
registerTakeScreenshot(server);

describe('take-screenshot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSemaphore.tryAcquire.mockReturnValue(true);
    mockBrowser.newPage.mockResolvedValue(mockPage);
    mockBrowser.close.mockResolvedValue(undefined);
    mockPage.setViewport.mockResolvedValue(undefined);
    mockPage.setRequestInterception.mockResolvedValue(undefined);
    mockPage.on.mockReturnValue(undefined);
    mockPage.goto.mockResolvedValue(undefined);
    mockPage.screenshot.mockResolvedValue(undefined);
  });

  it('returns error when URL validation fails', async () => {
    mockValidateUrl.mockResolvedValueOnce({
      valid: false,
      error: 'Invalid URL format',
    });

    const result = await capturedHandler({ url: 'not-a-url' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('URL validation failed');
    // Should not have tried to acquire semaphore
    expect(mockSemaphore.tryAcquire).not.toHaveBeenCalled();
  });

  it('returns error when path validation fails', async () => {
    mockValidateUrl.mockResolvedValueOnce({
      valid: true,
      resolvedIp: '93.184.216.34',
      hostname: 'example.com',
    });
    mockValidateOutputPath.mockResolvedValueOnce({
      valid: false,
      error: 'Path outside allowed directories',
    });

    const result = await capturedHandler({ url: 'https://example.com' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Output path validation failed');
    // Should not have tried to acquire semaphore
    expect(mockSemaphore.tryAcquire).not.toHaveBeenCalled();
  });

  it('returns error when semaphore is exhausted', async () => {
    mockValidateUrl.mockResolvedValueOnce({
      valid: true,
      resolvedIp: '93.184.216.34',
      hostname: 'example.com',
    });
    mockValidateOutputPath.mockResolvedValueOnce({
      valid: true,
      path: '/home/user/Desktop/Screenshots/screenshot.png',
    });
    mockSemaphore.tryAcquire.mockReturnValueOnce(false);

    const result = await capturedHandler({ url: 'https://example.com' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Concurrent screenshot limit reached');
  });

  it('returns ok on successful screenshot', async () => {
    mockValidateUrl.mockResolvedValueOnce({
      valid: true,
      resolvedIp: '93.184.216.34',
      hostname: 'example.com',
    });
    mockValidateOutputPath.mockResolvedValueOnce({
      valid: true,
      path: '/home/user/Desktop/Screenshots/screenshot.png',
    });

    const result = await capturedHandler({ url: 'https://example.com' });

    expect(result.content[0].text).toContain('Screenshot saved');
    expect(result.isError).toBeUndefined();
    // Semaphore should be released
    expect(mockSemaphore.release).toHaveBeenCalled();
  });

  it('releases semaphore even when browser operation fails', async () => {
    mockValidateUrl.mockResolvedValueOnce({
      valid: true,
      resolvedIp: '93.184.216.34',
      hostname: 'example.com',
    });
    mockValidateOutputPath.mockResolvedValueOnce({
      valid: true,
      path: '/home/user/Desktop/Screenshots/screenshot.png',
    });
    mockPage.goto.mockRejectedValueOnce(new Error('Navigation timeout'));

    const result = await capturedHandler({ url: 'https://example.com' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Screenshot error');
    // Semaphore must still be released
    expect(mockSemaphore.release).toHaveBeenCalled();
  });

  it('does not crash if browser.close() throws', async () => {
    mockValidateUrl.mockResolvedValueOnce({
      valid: true,
      resolvedIp: '93.184.216.34',
      hostname: 'example.com',
    });
    mockValidateOutputPath.mockResolvedValueOnce({
      valid: true,
      path: '/home/user/Desktop/Screenshots/screenshot.png',
    });
    mockBrowser.close.mockRejectedValueOnce(new Error('browser already closed'));

    const result = await capturedHandler({ url: 'https://example.com' });

    // Should still return ok (browser close error is swallowed)
    expect(result.content[0].text).toContain('Screenshot saved');
    expect(mockSemaphore.release).toHaveBeenCalled();
  });

  it('pins IPv4 address in host-resolver-rules without brackets', async () => {
    mockValidateUrl.mockResolvedValueOnce({
      valid: true,
      resolvedIp: '93.184.216.34',
      hostname: 'example.com',
    });
    mockValidateOutputPath.mockResolvedValueOnce({
      valid: true,
      path: '/home/user/Desktop/Screenshots/screenshot.png',
    });

    await capturedHandler({ url: 'https://example.com' });

    expect(mockLaunch).toHaveBeenCalledWith(expect.objectContaining({
      args: expect.arrayContaining([
        '--host-resolver-rules=MAP example.com 93.184.216.34',
      ]),
    }));
  });

  it('wraps IPv6 address in brackets for host-resolver-rules', async () => {
    mockValidateUrl.mockResolvedValueOnce({
      valid: true,
      resolvedIp: '2001:db8::1',
      hostname: 'ipv6host.example',
    });
    mockValidateOutputPath.mockResolvedValueOnce({
      valid: true,
      path: '/home/user/Desktop/Screenshots/screenshot.png',
    });

    await capturedHandler({ url: 'https://ipv6host.example' });

    expect(mockLaunch).toHaveBeenCalledWith(expect.objectContaining({
      args: expect.arrayContaining([
        '--host-resolver-rules=MAP ipv6host.example [2001:db8::1]',
      ]),
    }));
  });
});
