/**
 * Integration test for the connected-address check (SEC-001, DNS rebinding).
 *
 * Simulates a rebinding attack end to end: URL validation reports the target
 * as safe (as if DNS answered Node with a public address), but Chromium
 * actually connects to an internal address — here, the loopback test server.
 * The real isBlockedIp() then judges the address Chromium reports via
 * HTTPResponse.remoteAddress(), so this also catches a Chromium change to that
 * address format, which would otherwise make every screenshot fail closed.
 *
 * We mock only:
 * - config/runtime.js and config/index.js: temp output dir, test semaphore,
 *   and a switchable ALLOW_LOCAL
 * - validateUrl: always "valid", standing in for the rebinding DNS answer
 *
 * Everything else runs for real: Puppeteer, isBlockedIp, path validation, fs.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createTempTestDir, type TempTestDir } from '../helpers/temp-dir.js';
import { createTestServer, type TestServer } from '../helpers/test-server.js';
import { Semaphore } from '../../src/utils/semaphore.js';

let tmp: TempTestDir;
let server: TestServer;
let allowLocal = false;

const testSemaphore = new Semaphore(3);

vi.mock('../../src/config/runtime.js', () => ({
  get defaultOutDir() { return tmp.allowed; },
  ensureDefaultDirectory: vi.fn(),
  puppeteerSemaphore: {
    tryAcquire: () => testSemaphore.tryAcquire(),
    release: () => testSemaphore.release(),
  },
}));

vi.mock('../../src/config/index.js', () => ({
  get ALLOWED_OUTPUT_DIRS() { return [tmp.allowed, tmpdir()]; },
  MAX_CONCURRENT_SCREENSHOTS: 3,
  get ALLOW_LOCAL() { return allowLocal; },
  SCREENSHOT_DEADLINE_MS: 20_000,
}));

// validateUrl waves everything through (the "rebinding" DNS answer);
// isBlockedIp is the real implementation under test.
vi.mock('../../src/validators/url.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/validators/url.js')>()),
  validateUrl: vi.fn().mockImplementation(async (url: string) => ({
    valid: true,
    resolvedIp: '127.0.0.1',
    hostname: new URL(url).hostname,
  })),
}));

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

beforeAll(async () => {
  tmp = await createTempTestDir();
  server = await createTestServer();

  const mcpServer = new McpServer({ name: 'test', version: '1.0.0' } as any);
  registerTakeScreenshot(mcpServer);
}, 15_000);

afterAll(async () => {
  await server?.close();
  await tmp?.cleanup();
});

afterEach(() => {
  allowLocal = false;
});

describe('take_screenshot — connected-address check with real Chromium', () => {
  it('refuses the screenshot when Chromium connects to a blocked address', async () => {
    const dest = `${tmp.allowed}/rebind-blocked.png`;
    const result = await capturedHandler({ url: `${server.url}/simple.html`, outputPath: dest });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('URL validation failed');
    expect(result.content[0].text).toContain('connected to 127.0.0.1');
    expect(existsSync(dest)).toBe(false);
    // The page was fetched (the residual "blind request" risk), but never captured
    expect(server.requests).toContain('/simple.html');
  }, 30_000);

  it('checks every redirect hop, not just the final page', async () => {
    const dest = `${tmp.allowed}/rebind-redirect.png`;
    const result = await capturedHandler({ url: `${server.url}/redirect-ok`, outputPath: dest });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('connected to 127.0.0.1');
    expect(existsSync(dest)).toBe(false);
  }, 30_000);

  it('control: the same capture succeeds when ALLOW_LOCAL re-opens loopback', async () => {
    // Proves the refusals above come from the address check, and that the
    // address format Chromium reports parses as a valid IP.
    allowLocal = true;
    const dest = `${tmp.allowed}/rebind-allowed.png`;
    const result = await capturedHandler({ url: `${server.url}/simple.html`, outputPath: dest });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Screenshot saved');
    expect(existsSync(dest)).toBe(true);
  }, 30_000);
});
