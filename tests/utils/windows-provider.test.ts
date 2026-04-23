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
        ])
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
      expect(script).toContain('Notepad');
      expect(script).toContain('GetWindowRect');
    });

    it('preserves Unicode (CJK) characters in windowName end-to-end', async () => {
      await provider.captureWindow({ outputPath: 'C:\\test.png', windowName: '微信' });
      // -EncodedCommand uses base64 UTF-16LE so non-ASCII window names survive
      // the ANSI codepage on non-English Windows (the bug this PR fixes).
      expect(decodeScript()).toContain('微信');
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

  describe('path escaping', () => {
    it('escapes single quotes in output path', async () => {
      await provider.captureFullscreen({ outputPath: "C:\\Users\\it's a test\\screenshot.png" });
      expect(decodeScript()).toContain("it''s a test");
    });
  });
});
