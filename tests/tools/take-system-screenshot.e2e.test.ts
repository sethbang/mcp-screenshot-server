/**
 * E2E tests for take_system_screenshot on macOS.
 *
 * These tests call the real `screencapture` binary and verify real image files
 * are produced. Skipped on non-macOS platforms.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { createTempTestDir, type TempTestDir } from '../helpers/temp-dir.js';

let tmp: TempTestDir;

// Mock only config to point at test directories
vi.mock('../../src/config/runtime.js', () => ({
  get defaultOutDir() { return tmp.allowed; },
  ensureDefaultDirectory: vi.fn(),
}));

vi.mock('../../src/config/index.js', () => ({
  get ALLOWED_OUTPUT_DIRS() { return [tmp.allowed, '/tmp']; },
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

import { registerTakeSystemScreenshot } from '../../src/tools/take-system-screenshot.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const isMacOS = process.platform === 'darwin';

beforeAll(async () => {
  tmp = await createTempTestDir();
  const mcpServer = new McpServer({ name: 'test', version: '1.0.0' } as any);
  registerTakeSystemScreenshot(mcpServer);
});

afterAll(async () => {
  await tmp?.cleanup();
});

describe.skipIf(!isMacOS)('take_system_screenshot — real screencapture', () => {
  it('captures fullscreen and produces a valid PNG', async () => {
    const dest = `${tmp.allowed}/fullscreen.png`;
    const result = await capturedHandler({
      mode: 'fullscreen',
      outputPath: dest,
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('System screenshot saved');
    expect(existsSync(dest)).toBe(true);

    // Verify PNG magic bytes: 89 50 4E 47 0D 0A 1A 0A
    const header = readFileSync(dest).subarray(0, 8);
    expect(header[0]).toBe(0x89);
    expect(header[1]).toBe(0x50); // P
    expect(header[2]).toBe(0x4e); // N
    expect(header[3]).toBe(0x47); // G
  }, 15_000);

  it('captures a region and produces a file', async () => {
    const dest = `${tmp.allowed}/region.png`;
    const result = await capturedHandler({
      mode: 'region',
      region: { x: 0, y: 0, width: 100, height: 100 },
      outputPath: dest,
    });

    expect(result.isError).toBeUndefined();
    expect(existsSync(dest)).toBe(true);
    expect(readFileSync(dest).length).toBeGreaterThan(0);
  }, 15_000);

  it('captures in JPG format with correct magic bytes', async () => {
    const dest = `${tmp.allowed}/screenshot.jpg`;
    const result = await capturedHandler({
      mode: 'fullscreen',
      format: 'jpg',
      outputPath: dest,
    });

    expect(result.isError).toBeUndefined();
    expect(existsSync(dest)).toBe(true);

    // Verify JPEG magic bytes: FF D8 FF
    const header = readFileSync(dest).subarray(0, 3);
    expect(header[0]).toBe(0xff);
    expect(header[1]).toBe(0xd8);
    expect(header[2]).toBe(0xff);
  }, 15_000);

  it('rejects path traversal before screencapture runs', async () => {
    const result = await capturedHandler({
      mode: 'fullscreen',
      outputPath: `${tmp.allowed}/../../etc/test.png`,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Output path validation failed');
  });
});

describe.skipIf(!isMacOS)('MacOSProvider.isAvailable — real check', () => {
  it('returns true when screencapture is present', async () => {
    // Import the provider directly to test isAvailable
    const { getScreenshotProvider } = await import('../../src/utils/screenshot-provider.js');
    const provider = await getScreenshotProvider();
    expect(provider.platform).toBe('macOS');
    expect(await provider.isAvailable()).toBe(true);
  });
});
