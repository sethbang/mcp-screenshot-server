/**
 * E2E tests for take_system_screenshot on Windows.
 *
 * Runs the real PowerShell + .NET System.Drawing capture against a live desktop
 * session (GitHub Actions windows-latest in CI). Also runs PowerShell-injection
 * payloads through real PowerShell, which the mocked unit tests cannot do.
 * Skipped on non-Windows platforms.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Plain temp dir rather than createTempTestDir(): that helper creates directory
// symlinks, which need extra privileges on Windows and aren't needed here.
let dir: string;

// Mock only config to point at the test directory
vi.mock('../../src/config/runtime.js', () => ({
  get defaultOutDir() { return dir; },
  ensureDefaultDirectory: vi.fn(),
}));

vi.mock('../../src/config/index.js', () => ({
  get ALLOWED_OUTPUT_DIRS() { return [dir]; },
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

import { registerTakeSystemScreenshot } from '../../src/tools/take-system-screenshot.js';
import { execFileAsync } from '../../src/utils/screenshot-provider.js';
import { McpServer } from '@modelcontextprotocol/server';

const isWindows = process.platform === 'win32';

// PowerShell's tokenizer treats these as quote characters too (SEC-003)
const LEFT_SINGLE = '‘';
const RIGHT_SINGLE = '’';

/** Run a script through real PowerShell the same way the provider does. */
async function runPowerShell(script: string, env: Record<string, string> = {}): Promise<string> {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const { stdout } = await execFileAsync(
    'powershell',
    ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
    { env: { ...process.env, ...env } },
  );
  return stdout.trim();
}

function expectPng(path: string): Buffer {
  const buf = readFileSync(path);
  // PNG magic bytes: 89 50 4E 47
  expect([...buf.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  return buf;
}

/**
 * A payload that creates a marker file if it ever escapes into PowerShell code.
 * The marker is a bare relative name: a `\` or `:` inside the payload would
 * become a directory separator or an NTFS stream name once the payload is part
 * of outputPath. PowerShell inherits this process's cwd, so the marker lands there.
 */
const markers: string[] = [];
function injection(kind: string): { payload: string; marker: string } {
  const name = `mcp-e2e-pwned-${kind}-${randomUUID().slice(0, 8)}`;
  const marker = join(process.cwd(), name);
  markers.push(marker);
  return { payload: `$(New-Item -ItemType File -Path ${name})`, marker };
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mcp-win-e2e-'));
  const mcpServer = new McpServer({ name: 'test', version: '1.0.0' } as any);
  registerTakeSystemScreenshot(mcpServer);
});

afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
  await Promise.all(markers.map((m) => rm(m, { force: true })));
});

describe.skipIf(!isWindows)('take_system_screenshot — Windows real capture', () => {
  it('captures fullscreen and produces a valid PNG', async () => {
    const dest = join(dir, 'win-fullscreen.png');
    const result = await capturedHandler({ mode: 'fullscreen', outputPath: dest });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('System screenshot saved');
    expectPng(dest);
  }, 30_000);

  it('captures a region at exactly the requested size', async () => {
    const dest = join(dir, 'win-region.png');
    const result = await capturedHandler({
      mode: 'region',
      region: { x: 0, y: 0, width: 120, height: 80 },
      outputPath: dest,
    });

    expect(result.isError).toBeUndefined();
    const png = expectPng(dest);
    // IHDR width/height are big-endian uint32s at offsets 16 and 20
    expect(png.readUInt32BE(16)).toBe(120);
    expect(png.readUInt32BE(20)).toBe(80);
  }, 30_000);

  it('writes JPEG when format is jpg', async () => {
    const dest = join(dir, 'win-fullscreen.jpg');
    const result = await capturedHandler({ mode: 'fullscreen', format: 'jpg', outputPath: dest });

    expect(result.isError).toBeUndefined();
    // JPEG SOI marker: FF D8 FF
    expect([...readFileSync(dest).subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
  }, 30_000);

  it('rejects path traversal before capture runs', async () => {
    const result = await capturedHandler({
      mode: 'fullscreen',
      outputPath: join(dir, '..', '..', 'mcp-e2e-traversal.png'),
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Output path validation failed');
  });

  describe('window capture', () => {
    // Title contains -like wildcard characters, so only a literal match finds it
    const title = `mcp-e2e [x]*? ${randomUUID().slice(0, 8)}`;
    let child: ChildProcess | undefined;

    beforeAll(async () => {
      child = spawn(
        'powershell',
        [
          '-NoProfile', '-NonInteractive', '-Command',
          'Add-Type -AssemblyName System.Windows.Forms; ' +
          '$f = New-Object System.Windows.Forms.Form; ' +
          '$f.Text = $env:E2E_TITLE; $f.Width = 400; $f.Height = 300; ' +
          '[System.Windows.Forms.Application]::Run($f)',
        ],
        // windowsHide hides the console, so the form is the process's main window
        { env: { ...process.env, E2E_TITLE: title }, windowsHide: true, stdio: 'ignore' },
      );

      // Wait until Get-Process reports the form as a main window
      const deadline = Date.now() + 30_000;
      for (;;) {
        const count = await runPowerShell(
          '@(Get-Process | Where-Object { $_.MainWindowTitle -eq $env:E2E_TITLE }).Count',
          { E2E_TITLE: title },
        );
        if (count === '1') break;
        if (Date.now() > deadline) throw new Error(`Test window "${title}" never appeared`);
        await new Promise((r) => setTimeout(r, 500));
      }
    }, 45_000);

    afterAll(() => {
      child?.kill();
    });

    it('finds a window whose title contains wildcard characters, matched literally', async () => {
      const dest = join(dir, 'win-window.png');
      const result = await capturedHandler({ mode: 'window', windowName: title, outputPath: dest });

      expect(result.isError).toBeUndefined();
      expectPng(dest);
    }, 30_000);

    it('matches the window name case-insensitively', async () => {
      const dest = join(dir, 'win-window-upper.png');
      const result = await capturedHandler({
        mode: 'window',
        windowName: title.toUpperCase(),
        outputPath: dest,
      });

      expect(result.isError).toBeUndefined();
      expectPng(dest);
    }, 30_000);

    it('does not treat * in windowName as a wildcard', async () => {
      // As a -like pattern this would have matched the test window
      const result = await capturedHandler({
        mode: 'window',
        windowName: 'mcp-e2e *',
        outputPath: join(dir, 'win-window-wildcard.png'),
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Window not found');
    }, 30_000);
  });

  describe('PowerShell injection (SEC-003)', () => {
    it('control: the payload does execute under the old quote-doubling escape', async () => {
      // Proves the payloads below are real exploits on this PowerShell, so their
      // markers staying absent means the fix works, not that the payload is inert.
      const { payload, marker } = injection('control');
      const path = join(dir, `ctrl${RIGHT_SINGLE}+${payload}+${RIGHT_SINGLE}.txt`);
      const oldEscaped = path.replace(/'/g, "''"); // the removed escapePath()
      await runPowerShell(`[System.IO.File]::WriteAllText('${oldEscaped}', 'x')`).catch(() => {});

      expect(existsSync(marker)).toBe(true);
    }, 30_000);

    it('saves to the literal outputPath without executing it', async () => {
      const { payload, marker } = injection('output-path');
      const dest = join(dir, `x${RIGHT_SINGLE}+${payload}+${LEFT_SINGLE}.png`);
      const result = await capturedHandler({
        mode: 'region',
        region: { x: 0, y: 0, width: 10, height: 10 },
        outputPath: dest,
      });

      expect(existsSync(marker)).toBe(false);
      expect(result.isError).toBeUndefined();
      expectPng(dest);
    }, 30_000);

    it('treats windowName as data, not code', async () => {
      const { payload, marker } = injection('window-name');
      const result = await capturedHandler({
        mode: 'window',
        windowName: `zz${RIGHT_SINGLE}+${payload}+${RIGHT_SINGLE}`,
        outputPath: join(dir, 'win-injection-window.png'),
      });

      expect(existsSync(marker)).toBe(false);
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Window not found');
    }, 30_000);
  });
});
