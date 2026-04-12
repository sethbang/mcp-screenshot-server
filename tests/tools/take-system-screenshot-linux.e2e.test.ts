/**
 * E2E tests for take_system_screenshot on Linux.
 *
 * Runs inside Docker with Xvfb providing a virtual X11 display.
 * Tests real screenshot capture using maim, scrot, and import (ImageMagick).
 * Skipped on non-Linux platforms.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
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

const isLinux = process.platform === 'linux';

function hasCommand(cmd: string): boolean {
  try {
    execFileSync('which', [cmd], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

beforeAll(async () => {
  tmp = await createTempTestDir();
  const mcpServer = new McpServer({ name: 'test', version: '1.0.0' } as any);
  registerTakeSystemScreenshot(mcpServer);
});

afterAll(async () => {
  await tmp?.cleanup();
});

describe.skipIf(!isLinux)('take_system_screenshot — Linux real capture', () => {
  it('captures fullscreen and produces a valid PNG', async () => {
    const dest = `${tmp.allowed}/linux-fullscreen.png`;
    const result = await capturedHandler({
      mode: 'fullscreen',
      outputPath: dest,
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('System screenshot saved');
    expect(existsSync(dest)).toBe(true);

    // Verify PNG magic bytes: 89 50 4E 47
    const header = readFileSync(dest).subarray(0, 8);
    expect(header[0]).toBe(0x89);
    expect(header[1]).toBe(0x50);
    expect(header[2]).toBe(0x4e);
    expect(header[3]).toBe(0x47);
  }, 15_000);

  it('captures a region and produces a file', async () => {
    const dest = `${tmp.allowed}/linux-region.png`;
    const result = await capturedHandler({
      mode: 'region',
      region: { x: 0, y: 0, width: 100, height: 100 },
      outputPath: dest,
    });

    expect(result.isError).toBeUndefined();
    expect(existsSync(dest)).toBe(true);
    expect(readFileSync(dest).length).toBeGreaterThan(0);
  }, 15_000);

  it('rejects path traversal before capture runs', async () => {
    const result = await capturedHandler({
      mode: 'fullscreen',
      outputPath: `${tmp.allowed}/../../etc/test.png`,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Output path validation failed');
  });
});

describe.skipIf(!isLinux)('LinuxProvider — platform detection', () => {
  it('detects as Linux provider', async () => {
    const { getScreenshotProvider } = await import('../../src/utils/screenshot-provider.js');
    const provider = await getScreenshotProvider();
    expect(provider.platform).toBe('Linux');
    expect(await provider.isAvailable()).toBe(true);
  });

  it('has maim available', () => {
    expect(hasCommand('maim')).toBe(true);
  });

  it('has scrot available', () => {
    expect(hasCommand('scrot')).toBe(true);
  });

  it('has import (ImageMagick) available', () => {
    expect(hasCommand('import')).toBe(true);
  });

  it('has xdotool available', () => {
    expect(hasCommand('xdotool')).toBe(true);
  });
});
