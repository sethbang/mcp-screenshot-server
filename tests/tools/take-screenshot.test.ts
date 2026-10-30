import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
  SCREENSHOT_DEADLINE_MS: 1000,
}));

vi.mock('../../src/validators/url.js', () => ({
  validateUrl: vi.fn(),
  isBlockedIp: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  unlink: vi.fn(),
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

const mockProcess = {
  exitCode: null as number | null,
  signalCode: null as string | null,
  kill: vi.fn(),
};

const mockBrowser = {
  newPage: vi.fn().mockResolvedValue(mockPage),
  close: vi.fn(),
  on: vi.fn(),
};

vi.mock('puppeteer', () => ({
  default: {
    launch: vi.fn().mockResolvedValue({
      newPage: () => mockBrowser.newPage(),
      close: () => mockBrowser.close(),
      on: (...args: unknown[]) => mockBrowser.on(...args),
      process: () => mockProcess,
    }),
  },
}));

import puppeteer from 'puppeteer';
import { unlink } from 'node:fs/promises';
import { validateUrl, isBlockedIp } from '../../src/validators/url.js';
import { validateOutputPath } from '../../src/validators/path.js';

const mockLaunch = vi.mocked(puppeteer.launch);
const mockValidateUrl = vi.mocked(validateUrl);
const mockIsBlockedIp = vi.mocked(isBlockedIp);
const mockUnlink = vi.mocked(unlink);
const mockValidateOutputPath = vi.mocked(validateOutputPath);

// Capture the handler via McpServer mock
let capturedHandler: Function;

vi.mock('@modelcontextprotocol/server', () => ({
  McpServer: class {
    registerTool(_name: string, _schema: unknown, handler: Function) {
      capturedHandler = handler;
    }
  },
}));

import { registerTakeScreenshot } from '../../src/tools/take-screenshot.js';
import { McpServer } from '@modelcontextprotocol/server';

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
    mockUnlink.mockResolvedValue(undefined);
    mockIsBlockedIp.mockImplementation((ip: string) =>
      ip === '10.0.0.5' ? { blocked: true, reason: 'private network' } : { blocked: false });
    mockProcess.exitCode = null;
    mockProcess.signalCode = null;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function validInputs() {
    mockValidateUrl.mockResolvedValueOnce({
      valid: true,
      resolvedIp: '93.184.216.34',
      hostname: 'example.com',
    });
    mockValidateOutputPath.mockResolvedValueOnce({
      valid: true,
      path: '/home/user/Desktop/Screenshots/screenshot.png',
    });
  }

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

  describe('navigation response IP check (DNS rebinding on redirects/iframes)', () => {
    function fakeResponse(url: string, ip: string | undefined, isNavigation = true) {
      return {
        url: () => url,
        remoteAddress: () => ({ ip, port: 443 }),
        request: () => ({ isNavigationRequest: () => isNavigation }),
      };
    }

    /** Emit the given responses through the page's 'response' listener. */
    function emitResponses(...responses: ReturnType<typeof fakeResponse>[]) {
      const call = mockPage.on.mock.calls.find(([event]) => event === 'response');
      expect(call).toBeDefined();
      for (const res of responses) (call![1] as (r: unknown) => void)(res);
    }

    beforeEach(() => {
      mockValidateUrl.mockResolvedValueOnce({
        valid: true,
        resolvedIp: '93.184.216.34',
        hostname: 'example.com',
      });
      mockValidateOutputPath.mockResolvedValueOnce({
        valid: true,
        path: '/home/user/Desktop/Screenshots/screenshot.png',
      });
    });

    it('fails when a redirect hop connected to a blocked IP', async () => {
      mockPage.goto.mockImplementationOnce(async () => {
        emitResponses(
          fakeResponse('https://example.com/', '93.184.216.34'),
          fakeResponse('https://rebind.example/', '10.0.0.5'),
        );
      });

      const result = await capturedHandler({ url: 'https://example.com' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('rebind.example');
      expect(result.content[0].text).toContain('10.0.0.5');
      expect(mockPage.screenshot).not.toHaveBeenCalled();
      expect(mockSemaphore.release).toHaveBeenCalled();
    });

    it('deletes the file when a blocked navigation lands during capture', async () => {
      mockPage.screenshot.mockImplementationOnce(async () => {
        emitResponses(fakeResponse('https://iframe.example/', '10.0.0.5'));
      });

      const result = await capturedHandler({ url: 'https://example.com' });

      expect(result.isError).toBe(true);
      expect(mockUnlink).toHaveBeenCalledWith('/home/user/Desktop/Screenshots/screenshot.png');
    });

    it('ignores subresource responses and responses without a remote address', async () => {
      mockPage.goto.mockImplementationOnce(async () => {
        emitResponses(
          fakeResponse('https://example.com/', '93.184.216.34'),
          fakeResponse('https://cdn.example/img.png', '10.0.0.5', false),
          fakeResponse('about:blank', undefined),
        );
      });

      const result = await capturedHandler({ url: 'https://example.com' });

      expect(result.content[0].text).toContain('Screenshot saved');
      expect(mockIsBlockedIp).toHaveBeenCalledTimes(1);
      expect(mockIsBlockedIp).toHaveBeenCalledWith('93.184.216.34', { allowLocal: false });
    });
  });

  it('keeps Chromium\'s popup blocker enabled', async () => {
    validInputs();

    await capturedHandler({ url: 'https://example.com' });

    expect(mockLaunch).toHaveBeenCalledWith(expect.objectContaining({
      ignoreDefaultArgs: expect.arrayContaining(['--disable-popup-blocking']),
    }));
  });

  it('closes any popup target that slips past the blocker', async () => {
    validInputs();

    await capturedHandler({ url: 'https://example.com' });

    const handler = mockBrowser.on.mock.calls.find(([event]) => event === 'targetcreated')?.[1];
    expect(handler).toBeTypeOf('function');

    const popupPage = { close: vi.fn().mockResolvedValue(undefined) };
    handler({ opener: () => ({}), page: () => Promise.resolve(popupPage) });
    const ownPage = { close: vi.fn() };
    handler({ opener: () => undefined, page: () => Promise.resolve(ownPage) });
    await Promise.resolve(); await Promise.resolve();

    expect(popupPage.close).toHaveBeenCalled();
    expect(ownPage.close).not.toHaveBeenCalled();
  });

  it('kills the browser and releases the permit when the deadline passes', async () => {
    vi.useFakeTimers();
    validInputs();
    // Simulates the popup wedge: screenshot() never settles
    mockPage.screenshot.mockReturnValueOnce(new Promise(() => {}));

    const pending = capturedHandler({ url: 'https://example.com' });
    await vi.advanceTimersByTimeAsync(1000);
    const result = await pending;

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('timed out after 1000ms');
    // Graceful close is skipped on timeout — it would likely hang too
    expect(mockBrowser.close).not.toHaveBeenCalled();
    expect(mockProcess.kill).toHaveBeenCalledWith('SIGKILL');
    expect(mockSemaphore.release).toHaveBeenCalledTimes(1);
  });

  it('kills the browser when the deadline passes during launch', async () => {
    vi.useFakeTimers();
    validInputs();
    let finishLaunch!: () => void;
    mockLaunch.mockImplementationOnce(() => new Promise(resolve => {
      finishLaunch = () => resolve({
        newPage: () => mockBrowser.newPage(),
        close: () => mockBrowser.close(),
        on: (...args: unknown[]) => mockBrowser.on(...args),
        process: () => mockProcess,
      } as any);
    }));

    const pending = capturedHandler({ url: 'https://example.com' });
    await vi.advanceTimersByTimeAsync(1000);
    const result = await pending;
    expect(result.content[0].text).toContain('timed out');
    expect(mockSemaphore.release).toHaveBeenCalledTimes(1);

    // Launch completes after the handler has already returned — no orphan
    finishLaunch();
    await vi.advanceTimersByTimeAsync(0);
    expect(mockProcess.kill).toHaveBeenCalledWith('SIGKILL');
    expect(mockBrowser.newPage).not.toHaveBeenCalled();
  });

  it('falls back to SIGKILL when browser.close() hangs', async () => {
    vi.useFakeTimers();
    validInputs();
    mockBrowser.close.mockReturnValueOnce(new Promise(() => {}));

    const pending = capturedHandler({ url: 'https://example.com' });
    await vi.advanceTimersByTimeAsync(5000);
    const result = await pending;

    expect(result.content[0].text).toContain('Screenshot saved');
    expect(mockProcess.kill).toHaveBeenCalledWith('SIGKILL');
    expect(mockSemaphore.release).toHaveBeenCalledTimes(1);
  });

  it('does not signal a browser process that already exited', async () => {
    validInputs();
    mockBrowser.close.mockImplementationOnce(async () => { mockProcess.exitCode = 0; });

    await capturedHandler({ url: 'https://example.com' });

    expect(mockProcess.kill).not.toHaveBeenCalled();
  });
});
