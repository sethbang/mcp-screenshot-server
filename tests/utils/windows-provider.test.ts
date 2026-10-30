import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the screenshot-provider module
vi.mock('../../src/utils/screenshot-provider.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/utils/screenshot-provider.js')>();
  return {
    ...original,
    commandExists: vi.fn().mockResolvedValue(true),
    execFileAsync: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
    sleep: vi.fn().mockResolvedValue(undefined),
  };
});

import { WindowsProvider } from '../../src/utils/windows-provider.js';
import { execFileAsync, sleep } from '../../src/utils/screenshot-provider.js';

const mockExecFile = vi.mocked(execFileAsync);
const mockSleep = vi.mocked(sleep);

// PowerShell scripts are now passed via -EncodedCommand (base64 UTF-16LE) so
// that Unicode arguments survive the ANSI codepage on non-English Windows.
function decodeScript(callIndex = 0): string {
  const args = mockExecFile.mock.calls[callIndex][1] as string[];
  const encoded = args[args.length - 1];
  return Buffer.from(encoded, 'base64').toString('utf16le');
}

// Untrusted values are passed to PowerShell as environment variables.
function spawnEnv(callIndex = 0): NodeJS.ProcessEnv {
  const opts = mockExecFile.mock.calls[callIndex][2] as { env: NodeJS.ProcessEnv };
  return opts.env;
}

// Payloads that break out of a PowerShell string literal. PowerShell treats
// U+2018–U+201B as single quotes and U+201C–U+201E as double quotes, so
// escaping ASCII quotes alone is not enough.
const UNICODE_QUOTES = ['\u2018', '\u2019', '\u201A', '\u201B', '\u201C', '\u201D', '\u201E'];
const MALICIOUS_PATHS = [
  'C:\\Users\\me\\Documents\\x\u2019+$(Start-Process calc)+\u2019.png',
  'C:\\Users\\me\\Documents\\x\u2018+$(Start-Process calc)+\u2018.png',
  'C:\\Users\\me\\Documents\\x\u201A+$(Start-Process calc)+\u201A.png',
  'C:\\Users\\me\\Documents\\x\u201B+$(Start-Process calc)+\u201B.png',
  'C:\\Users\\me\\Documents\\x\u201C$(Start-Process calc)\u201D.png',
  'C:\\Users\\me\\Documents\\x\u201E$(Start-Process calc)\u201E.png',
  "C:\\Users\\me\\Documents\\x'+$(Start-Process calc)+'.png",
  'C:\\Users\\me\\Documents\\x`$(Start-Process calc)`.png',
];
const MALICIOUS_WINDOW_NAMES = [
  '\u2019+(Start-Process calc)+\u2019',
  '\u2018+(Start-Process calc)+\u2018',
  '\u201A+(Start-Process calc)+\u201A',
  '\u201B+(Start-Process calc)+\u201B',
  '\u201C$(Start-Process calc)\u201D',
  '\u201E$(Start-Process calc)\u201E',
  "'+(Start-Process calc)+'",
  '"$(Start-Process calc)"',
  '`$(Start-Process calc)`',
  '*[a-z]?',
];

function expectNoInjection(script: string, ...values: string[]): void {
  for (const value of values) {
    expect(script).not.toContain(value);
  }
  expect(script).not.toContain('Start-Process');
  // The script body is static ASCII, so no Unicode quote can appear in it.
  expect(script).toMatch(/^[\x00-\x7F]*$/);
  for (const ch of UNICODE_QUOTES) {
    expect(script).not.toContain(ch);
  }
}

describe('WindowsProvider', () => {
  let provider: WindowsProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new WindowsProvider();
  });

  it('has platform name "Windows"', () => {
    expect(provider.platform).toBe('Windows');
  });

  describe('captureFullscreen', () => {
    it('includes DPI awareness snippet', async () => {
      await provider.captureFullscreen({ outputPath: 'C:\\test.png' });
      expect(decodeScript()).toContain('SetProcessDPIAware');
    });

    it('calls powershell with CopyFromScreen script', async () => {
      await provider.captureFullscreen({ outputPath: 'C:\\Users\\test\\screenshot.png' });

      expect(mockExecFile).toHaveBeenCalledWith(
        'powershell',
        expect.arrayContaining([
          '-ExecutionPolicy', 'Bypass',
          '-NoProfile',
          '-NonInteractive',
          '-EncodedCommand',
          expect.any(String),
        ]),
        expect.objectContaining({
          env: expect.objectContaining({ SS_OUTPUT_PATH: 'C:\\Users\\test\\screenshot.png' }),
        })
      );
      expect(decodeScript()).toContain('CopyFromScreen');
    });

    it('includes Png format by default', async () => {
      await provider.captureFullscreen({ outputPath: 'C:\\test.png' });
      expect(decodeScript()).toContain('ImageFormat]::Png');
    });

    it('uses Jpeg format when jpg is specified', async () => {
      await provider.captureFullscreen({ outputPath: 'C:\\test.jpg', format: 'jpg' });
      expect(decodeScript()).toContain('ImageFormat]::Jpeg');
    });

    it('sleeps when delay is specified', async () => {
      await provider.captureFullscreen({ outputPath: 'C:\\test.png', delay: 3 });
      expect(mockSleep).toHaveBeenCalledWith(3);
    });

    it('captures the entire virtual desktop when no display is specified', async () => {
      await provider.captureFullscreen({ outputPath: 'C:\\test.png' });

      const script = decodeScript();
      expect(script).toContain('SystemInformation]::VirtualScreen');
      expect(script).not.toContain('AllScreens');
    });

    it('selects a specific monitor when display is specified', async () => {
      await provider.captureFullscreen({ outputPath: 'C:\\test.png', display: 2 });

      const script = decodeScript();
      // Display 2 → index 1 (0-based) into AllScreens
      expect(script).toContain('AllScreens');
      expect(script).toContain('$screens[1]');
      expect(script).not.toContain('VirtualScreen');
    });
  });

  describe('captureWindow', () => {
    it('includes DPI awareness snippet', async () => {
      await provider.captureWindow({ outputPath: 'C:\\test.png', windowName: 'Notepad' });
      expect(decodeScript()).toContain('SetProcessDPIAware');
    });

    it('searches for window by name using Get-Process', async () => {
      await provider.captureWindow({ outputPath: 'C:\\test.png', windowName: 'Notepad' });

      const script = decodeScript();
      expect(script).toContain('Get-Process');
      expect(script).toContain('$env:SS_WINDOW_NAME');
      expect(script).toContain('GetWindowRect');
      expect(spawnEnv().SS_WINDOW_NAME).toBe('Notepad');
    });

    it('matches window titles as a literal, case-insensitive substring', async () => {
      await provider.captureWindow({ outputPath: 'C:\\test.png', windowName: 'Notepad' });

      const script = decodeScript();
      expect(script).toContain('OrdinalIgnoreCase');
      expect(script).not.toContain('-like');
    });

    it('preserves Unicode (CJK) characters in windowName end-to-end', async () => {
      await provider.captureWindow({ outputPath: 'C:\\test.png', windowName: '微信' });
      // Passed via the process environment (UTF-16 on Windows), so non-ASCII
      // window names survive the ANSI codepage on non-English Windows.
      expect(spawnEnv().SS_WINDOW_NAME).toBe('微信');
      expect(decodeScript()).not.toContain('微信');
    });

    it('does not set SS_WINDOW_NAME when targeting by windowId', async () => {
      await provider.captureWindow({ outputPath: 'C:\\test.png', windowId: 12345 });
      expect(decodeScript()).not.toContain('SS_WINDOW_NAME');
    });

    it('uses windowId as HWND when provided', async () => {
      await provider.captureWindow({ outputPath: 'C:\\test.png', windowId: 12345 });
      expect(decodeScript()).toContain('[IntPtr]::new(12345)');
    });

    it('throws when no windowName or windowId provided', async () => {
      await expect(
        provider.captureWindow({ outputPath: 'C:\\test.png' })
      ).rejects.toThrow('Window mode requires windowName or windowId');
    });
  });

  describe('captureRegion', () => {
    it('includes DPI awareness snippet', async () => {
      await provider.captureRegion({
        outputPath: 'C:\\test.png',
        x: 0, y: 0, width: 100, height: 100,
      });
      expect(decodeScript()).toContain('SetProcessDPIAware');
    });

    it('calls powershell with region coordinates', async () => {
      await provider.captureRegion({
        outputPath: 'C:\\test.png',
        x: 100, y: 200, width: 800, height: 600,
      });

      const script = decodeScript();
      expect(script).toContain('800');
      expect(script).toContain('600');
      expect(script).toContain('100');
      expect(script).toContain('200');
      expect(script).toContain('CopyFromScreen');
    });
  });

  describe('injection prevention', () => {
    it('passes outputPath via environment, not script text', async () => {
      const outputPath = "C:\\Users\\it's a test\\screenshot.png";
      await provider.captureFullscreen({ outputPath });

      expect(decodeScript()).toContain('$bitmap.Save($env:SS_OUTPUT_PATH,');
      expect(decodeScript()).not.toContain("it's a test");
      expect(spawnEnv().SS_OUTPUT_PATH).toBe(outputPath);
    });

    it('preserves the rest of the parent environment', async () => {
      await provider.captureFullscreen({ outputPath: 'C:\\test.png' });
      expect(spawnEnv().PATH).toBe(process.env.PATH);
    });

    it.each(MALICIOUS_PATHS)('captureFullscreen never embeds outputPath %s', async (outputPath) => {
      await provider.captureFullscreen({ outputPath, display: 1, includeCursor: true });
      expectNoInjection(decodeScript(), outputPath);
      expect(spawnEnv().SS_OUTPUT_PATH).toBe(outputPath);
    });

    it.each(MALICIOUS_PATHS)('captureRegion never embeds outputPath %s', async (outputPath) => {
      await provider.captureRegion({ outputPath, x: 0, y: 0, width: 10, height: 10 });
      expectNoInjection(decodeScript(), outputPath);
      expect(spawnEnv().SS_OUTPUT_PATH).toBe(outputPath);
    });

    it.each(MALICIOUS_PATHS)('captureWindow never embeds outputPath %s', async (outputPath) => {
      await provider.captureWindow({ outputPath, windowId: 1 });
      expectNoInjection(decodeScript(), outputPath);
      expect(spawnEnv().SS_OUTPUT_PATH).toBe(outputPath);
    });

    it.each(MALICIOUS_WINDOW_NAMES)('captureWindow never embeds windowName %s', async (windowName) => {
      const outputPath = MALICIOUS_PATHS[0];
      await provider.captureWindow({ outputPath, windowName });
      expectNoInjection(decodeScript(), outputPath, windowName);
      expect(spawnEnv().SS_WINDOW_NAME).toBe(windowName);
      expect(spawnEnv().SS_OUTPUT_PATH).toBe(outputPath);
    });
  });
});
