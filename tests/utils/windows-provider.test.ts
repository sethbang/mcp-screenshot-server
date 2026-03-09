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
      const script = mockExecFile.mock.calls[0][1].slice(-1)[0];
      expect(script).toContain('SetProcessDPIAware');
    });

    it('calls powershell with CopyFromScreen script', async () => {
      await provider.captureFullscreen({ outputPath: 'C:\\Users\\test\\screenshot.png' });

      expect(mockExecFile).toHaveBeenCalledWith(
        'powershell',
        expect.arrayContaining([
          '-ExecutionPolicy', 'Bypass',
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          expect.stringContaining('CopyFromScreen'),
        ])
      );
    });

    it('includes Png format by default', async () => {
      await provider.captureFullscreen({ outputPath: 'C:\\test.png' });

      const script = mockExecFile.mock.calls[0][1].slice(-1)[0];
      expect(script).toContain('ImageFormat]::Png');
    });

    it('uses Jpeg format when jpg is specified', async () => {
      await provider.captureFullscreen({ outputPath: 'C:\\test.jpg', format: 'jpg' });

      const script = mockExecFile.mock.calls[0][1].slice(-1)[0];
      expect(script).toContain('ImageFormat]::Jpeg');
    });

    it('sleeps when delay is specified', async () => {
      await provider.captureFullscreen({ outputPath: 'C:\\test.png', delay: 3 });
      expect(mockSleep).toHaveBeenCalledWith(3);
    });

    it('handles display selection', async () => {
      await provider.captureFullscreen({ outputPath: 'C:\\test.png', display: 2 });

      const script = mockExecFile.mock.calls[0][1].slice(-1)[0];
      // Display 2 = index 1 (0-based)
      expect(script).toContain('1');
      expect(script).toContain('AllScreens');
    });
  });

  describe('captureWindow', () => {
    it('includes DPI awareness snippet', async () => {
      await provider.captureWindow({ outputPath: 'C:\\test.png', windowName: 'Notepad' });
      const script = mockExecFile.mock.calls[0][1].slice(-1)[0];
      expect(script).toContain('SetProcessDPIAware');
    });

    it('searches for window by name using Get-Process', async () => {
      await provider.captureWindow({ outputPath: 'C:\\test.png', windowName: 'Notepad' });

      const script = mockExecFile.mock.calls[0][1].slice(-1)[0];
      expect(script).toContain('Get-Process');
      expect(script).toContain('Notepad');
      expect(script).toContain('GetWindowRect');
    });

    it('uses windowId as HWND when provided', async () => {
      await provider.captureWindow({ outputPath: 'C:\\test.png', windowId: 12345 });

      const script = mockExecFile.mock.calls[0][1].slice(-1)[0];
      expect(script).toContain('[IntPtr]::new(12345)');
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
      const script = mockExecFile.mock.calls[0][1].slice(-1)[0];
      expect(script).toContain('SetProcessDPIAware');
    });

    it('calls powershell with region coordinates', async () => {
      await provider.captureRegion({
        outputPath: 'C:\\test.png',
        x: 100, y: 200, width: 800, height: 600,
      });

      const script = mockExecFile.mock.calls[0][1].slice(-1)[0];
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

      const script = mockExecFile.mock.calls[0][1].slice(-1)[0];
      expect(script).toContain("it''s a test");
    });
  });
});
