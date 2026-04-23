import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock dependencies ──────────────────────────────────────────────────────

vi.mock('../../src/config/runtime.js', () => ({
  defaultOutDir: '/home/user/Desktop/Screenshots',
  ensureDefaultDirectory: vi.fn(),
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

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

// Mock the screenshot provider module
// NOTE: vi.mock is hoisted, so we use vi.hoisted() to define the mock provider
const { mockProvider } = vi.hoisted(() => {
  const mockProvider = {
    platform: 'MockOS',
    isAvailable: vi.fn().mockResolvedValue(true),
    captureFullscreen: vi.fn().mockResolvedValue(undefined),
    captureWindow: vi.fn().mockResolvedValue(undefined),
    captureRegion: vi.fn().mockResolvedValue(undefined),
  };
  return { mockProvider };
});

vi.mock('../../src/utils/screenshot-provider.js', () => ({
  getScreenshotProvider: vi.fn().mockResolvedValue(mockProvider),
}));

import { validateOutputPath } from '../../src/validators/path.js';

const mockValidateOutputPath = vi.mocked(validateOutputPath);

// Capture the handler by mocking McpServer
let capturedHandler: Function;
let capturedSchema: { inputSchema: Record<string, unknown> };

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: class {
    registerTool(_name: string, schema: { inputSchema: Record<string, unknown> }, handler: Function) {
      capturedHandler = handler;
      capturedSchema = schema;
    }
  },
}));

import { registerTakeSystemScreenshot } from '../../src/tools/take-system-screenshot.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z, type ZodType } from 'zod';

const server = new McpServer({ name: 'test', version: '1.0.0' } as any);
registerTakeSystemScreenshot(server);

describe('take-system-screenshot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProvider.captureFullscreen.mockResolvedValue(undefined);
    mockProvider.captureWindow.mockResolvedValue(undefined);
    mockProvider.captureRegion.mockResolvedValue(undefined);
    mockProvider.isAvailable.mockResolvedValue(true);
  });

  it('returns error when path validation fails', async () => {
    mockValidateOutputPath.mockResolvedValueOnce({
      valid: false,
      error: 'Path outside allowed directories',
    });

    const result = await capturedHandler({ mode: 'fullscreen' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Output path validation failed');
  });

  it('calls captureFullscreen for fullscreen mode and returns ok on success', async () => {
    mockValidateOutputPath.mockResolvedValueOnce({
      valid: true,
      path: '/home/user/Desktop/Screenshots/screenshot.png',
    });

    const { existsSync } = await import('fs');
    vi.mocked(existsSync).mockReturnValueOnce(true);

    const result = await capturedHandler({ mode: 'fullscreen' });

    expect(mockProvider.captureFullscreen).toHaveBeenCalledWith(
      expect.objectContaining({ outputPath: '/home/user/Desktop/Screenshots/screenshot.png' })
    );
    expect(result.content[0].text).toContain('System screenshot saved');
    expect(result.isError).toBeUndefined();
  });

  it('passes format, delay, display, and includeCursor to provider', async () => {
    mockValidateOutputPath.mockResolvedValueOnce({
      valid: true,
      path: '/home/user/Desktop/Screenshots/screenshot.jpg',
    });

    const { existsSync } = await import('fs');
    vi.mocked(existsSync).mockReturnValueOnce(true);

    await capturedHandler({
      mode: 'fullscreen',
      format: 'jpg',
      delay: 2,
      display: 2,
      includeCursor: true,
    });

    expect(mockProvider.captureFullscreen).toHaveBeenCalledWith(
      expect.objectContaining({
        format: 'jpg',
        delay: 2,
        display: 2,
        includeCursor: true,
      })
    );
  });

  it('returns error when screenshot file not found after capture', async () => {
    mockValidateOutputPath.mockResolvedValueOnce({
      valid: true,
      path: '/home/user/Desktop/Screenshots/screenshot.png',
    });

    const { existsSync } = await import('fs');
    vi.mocked(existsSync).mockReturnValueOnce(false);

    const result = await capturedHandler({ mode: 'fullscreen' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Screenshot failed');
  });

  it('calls captureWindow with windowId in window mode', async () => {
    mockValidateOutputPath.mockResolvedValueOnce({
      valid: true,
      path: '/home/user/Desktop/Screenshots/screenshot.png',
    });

    const { existsSync } = await import('fs');
    vi.mocked(existsSync).mockReturnValueOnce(true);

    const result = await capturedHandler({ mode: 'window', windowId: 42 });

    expect(mockProvider.captureWindow).toHaveBeenCalledWith(
      expect.objectContaining({ windowId: 42 })
    );
    expect(result.content[0].text).toContain('System screenshot saved');
  });

  it('calls captureWindow with windowName in window mode', async () => {
    mockValidateOutputPath.mockResolvedValueOnce({
      valid: true,
      path: '/home/user/Desktop/Screenshots/screenshot.png',
    });

    const { existsSync } = await import('fs');
    vi.mocked(existsSync).mockReturnValueOnce(true);

    const result = await capturedHandler({ mode: 'window', windowName: 'Safari' });

    expect(mockProvider.captureWindow).toHaveBeenCalledWith(
      expect.objectContaining({ windowName: 'Safari' })
    );
    expect(result.content[0].text).toContain('System screenshot saved');
  });

  it('returns error when provider throws for window not found', async () => {
    mockValidateOutputPath.mockResolvedValueOnce({
      valid: true,
      path: '/home/user/Desktop/Screenshots/screenshot.png',
    });

    mockProvider.captureWindow.mockRejectedValueOnce(new Error('Window not found: NonExistentApp'));

    const result = await capturedHandler({ mode: 'window', windowName: 'NonExistentApp' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Window not found: NonExistentApp');
  });

  it('returns error in region mode without region coordinates', async () => {
    mockValidateOutputPath.mockResolvedValueOnce({
      valid: true,
      path: '/home/user/Desktop/Screenshots/screenshot.png',
    });

    const result = await capturedHandler({ mode: 'region' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Region mode requires region coordinates');
  });

  it('calls captureRegion with valid coordinates', async () => {
    mockValidateOutputPath.mockResolvedValueOnce({
      valid: true,
      path: '/home/user/Desktop/Screenshots/screenshot.png',
    });

    const { existsSync } = await import('fs');
    vi.mocked(existsSync).mockReturnValueOnce(true);

    const result = await capturedHandler({
      mode: 'region',
      region: { x: 0, y: 0, width: 800, height: 600 },
    });

    expect(mockProvider.captureRegion).toHaveBeenCalledWith(
      expect.objectContaining({ x: 0, y: 0, width: 800, height: 600 })
    );
    expect(result.content[0].text).toContain('System screenshot saved');
  });

  describe('input schema validation', () => {
    it('rejects non-integer display values', () => {
      const schema = z.object(capturedSchema.inputSchema as Record<string, ZodType>);
      const result = schema.safeParse({ mode: 'fullscreen', display: 1.5 });
      expect(result.success).toBe(false);
    });

    it('accepts integer display values', () => {
      const schema = z.object(capturedSchema.inputSchema as Record<string, ZodType>);
      const result = schema.safeParse({ mode: 'fullscreen', display: 2 });
      expect(result.success).toBe(true);
    });
  });

  it('returns error when provider is unavailable', async () => {
    const { getScreenshotProvider } = await import('../../src/utils/screenshot-provider.js');
    vi.mocked(getScreenshotProvider).mockRejectedValueOnce(
      new Error('No screenshot tools found for Linux. See README for required system dependencies.')
    );

    mockValidateOutputPath.mockResolvedValueOnce({
      valid: true,
      path: '/home/user/Desktop/Screenshots/screenshot.png',
    });

    const result = await capturedHandler({ mode: 'fullscreen' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('No screenshot tools found');
  });
});
