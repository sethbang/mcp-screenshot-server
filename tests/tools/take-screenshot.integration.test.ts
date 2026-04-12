/**
 * Integration tests for the take_screenshot tool with real Puppeteer.
 *
 * Unlike unit tests which mock everything, these tests launch a real Chromium
 * browser against a local HTTP test server and write real files to disk.
 *
 * We mock only:
 * - config/runtime.js: to point at a temp output directory and provide a test semaphore
 * - config/index.js: to set allowed output dirs to our temp directory
 * - validators/url.js: to allow our local 127.0.0.1 test server (URL validation
 *   has its own integration tests in url.integration.test.ts)
 *
 * Everything else runs for real: Puppeteer, path validation, filesystem I/O.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { existsSync, statSync, readFileSync } from 'node:fs';
import { createTempTestDir, type TempTestDir } from '../helpers/temp-dir.js';
import { createTestServer, type TestServer } from '../helpers/test-server.js';
import { Semaphore } from '../../src/utils/semaphore.js';

let tmp: TempTestDir;
let server: TestServer;

// Mock config to use test-specific directories
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
  get ALLOWED_OUTPUT_DIRS() { return [tmp.allowed, '/tmp']; },
  MAX_CONCURRENT_SCREENSHOTS: 3,
  ALLOW_LOCAL: false,
}));

// Mock URL validator to allow our local test server.
// URL validation is covered by its own integration tests.
vi.mock('../../src/validators/url.js', () => ({
  validateUrl: vi.fn().mockImplementation(async (url: string) => {
    try {
      const parsed = new URL(url);
      // Allow our test server and block everything else
      if (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost') {
        return { valid: true, resolvedIp: '127.0.0.1', hostname: parsed.hostname };
      }
      // Block cloud metadata / private IPs (for redirect tests)
      if (parsed.hostname === '169.254.169.254' || parsed.hostname === '10.0.0.1') {
        return { valid: false, error: 'Access to blocked IP' };
      }
      return { valid: false, error: `Blocked in test: ${url}` };
    } catch {
      return { valid: false, error: 'Invalid URL format' };
    }
  }),
}));

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

describe('take_screenshot — real Puppeteer', () => {
  it('captures a basic screenshot and writes a PNG to disk', async () => {
    const result = await capturedHandler({
      url: `${server.url}/simple.html`,
      outputPath: `${tmp.allowed}/basic.png`,
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Screenshot saved');

    // Verify real file was created
    const filePath = `${tmp.allowed}/basic.png`;
    expect(existsSync(filePath)).toBe(true);
    expect(statSync(filePath).size).toBeGreaterThan(0);

    // Verify PNG magic bytes
    const header = readFileSync(filePath).subarray(0, 8);
    expect(header[0]).toBe(0x89);
    expect(header[1]).toBe(0x50); // P
    expect(header[2]).toBe(0x4e); // N
    expect(header[3]).toBe(0x47); // G
  }, 30_000);

  it('captures with custom viewport dimensions', async () => {
    const result = await capturedHandler({
      url: `${server.url}/simple.html`,
      width: 800,
      height: 600,
      outputPath: `${tmp.allowed}/viewport.png`,
    });

    expect(result.isError).toBeUndefined();
    expect(existsSync(`${tmp.allowed}/viewport.png`)).toBe(true);
  }, 30_000);

  it('captures a specific element by CSS selector', async () => {
    const result = await capturedHandler({
      url: `${server.url}/simple.html`,
      selector: '#target',
      outputPath: `${tmp.allowed}/element.png`,
    });

    expect(result.isError).toBeUndefined();
    expect(existsSync(`${tmp.allowed}/element.png`)).toBe(true);
  }, 30_000);

  it('returns error when selector does not exist', async () => {
    const result = await capturedHandler({
      url: `${server.url}/simple.html`,
      selector: '#nonexistent',
      outputPath: `${tmp.allowed}/missing.png`,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Element not found');
  }, 30_000);

  it('captures full page content', async () => {
    const result = await capturedHandler({
      url: `${server.url}/tall-page.html`,
      fullPage: true,
      outputPath: `${tmp.allowed}/fullpage.png`,
    });

    expect(result.isError).toBeUndefined();
    expect(existsSync(`${tmp.allowed}/fullpage.png`)).toBe(true);

    // Full page screenshot should be larger than a viewport-only screenshot
    const fullPageSize = statSync(`${tmp.allowed}/fullpage.png`).size;
    expect(fullPageSize).toBeGreaterThan(1000);
  }, 30_000);

  it('waits for a dynamically added element before capture', async () => {
    const result = await capturedHandler({
      url: `${server.url}/delayed-element.html`,
      waitForSelector: '#delayed',
      outputPath: `${tmp.allowed}/delayed.png`,
    });

    expect(result.isError).toBeUndefined();
    expect(existsSync(`${tmp.allowed}/delayed.png`)).toBe(true);
  }, 30_000);

  it('blocks a redirect to a cloud metadata IP', async () => {
    const result = await capturedHandler({
      url: `${server.url}/redirect-evil`,
      outputPath: `${tmp.allowed}/evil.png`,
    });

    // The redirect to 169.254.169.254 should be blocked by the request interceptor.
    // This results in a navigation error since the redirect target is aborted.
    expect(result.isError).toBe(true);
  }, 30_000);

  it('follows a redirect to a safe local endpoint', async () => {
    const result = await capturedHandler({
      url: `${server.url}/redirect-ok`,
      outputPath: `${tmp.allowed}/redirect-ok.png`,
    });

    expect(result.isError).toBeUndefined();
    expect(existsSync(`${tmp.allowed}/redirect-ok.png`)).toBe(true);
  }, 30_000);

  it('rejects path traversal in outputPath', async () => {
    const result = await capturedHandler({
      url: `${server.url}/simple.html`,
      outputPath: `${tmp.allowed}/../../etc/test.png`,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Output path validation failed');
  }, 30_000);

  it('rejects when semaphore permits are exhausted', async () => {
    // Drain the semaphore manually, then verify the handler rejects
    const acquired: boolean[] = [];
    while (testSemaphore.tryAcquire()) {
      acquired.push(true);
    }

    try {
      const result = await capturedHandler({
        url: `${server.url}/simple.html`,
        outputPath: `${tmp.allowed}/sem-blocked.png`,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Concurrent screenshot limit reached');
    } finally {
      // Restore all permits
      for (const _ of acquired) {
        testSemaphore.release();
      }
    }
  }, 10_000);
});
