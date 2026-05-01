import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the screenshot-provider module
vi.mock('../../src/utils/screenshot-provider.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/utils/screenshot-provider.js')>();
  return {
    ...original,
    commandExists: vi.fn().mockResolvedValue(false),
    execFileAsync: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
    sleep: vi.fn().mockResolvedValue(undefined),
  };
});

// Mock linux-deps so detectLinuxDistro doesn't read real /etc/os-release.
vi.mock('../../src/utils/linux-deps.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/utils/linux-deps.js')>();
  return {
    ...original,
    detectLinuxDistro: vi.fn().mockResolvedValue({
      id: 'ubuntu',
      idLike: ['debian'],
      packageManager: 'apt',
    }),
  };
});

import { LinuxProvider } from '../../src/utils/linux-provider.js';
import { commandExists, execFileAsync, sleep } from '../../src/utils/screenshot-provider.js';

const mockCommandExists = vi.mocked(commandExists);
const mockExecFile = vi.mocked(execFileAsync);
const mockSleep = vi.mocked(sleep);

describe('LinuxProvider', () => {
  let provider: LinuxProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    // Create a fresh provider each time to reset backend detection
    provider = new LinuxProvider();
  });

  it('has platform name "Linux"', () => {
    expect(provider.platform).toBe('Linux');
  });

  describe('isAvailable', () => {
    it('returns false when no tools are found', async () => {
      mockCommandExists.mockResolvedValue(false);
      expect(await provider.isAvailable()).toBe(false);
    });

    it('returns true when maim is found', async () => {
      mockCommandExists.mockImplementation(async (cmd) => cmd === 'maim');
      expect(await provider.isAvailable()).toBe(true);
    });

    it('returns true when scrot is found', async () => {
      mockCommandExists.mockImplementation(async (cmd) => cmd === 'scrot');
      expect(await provider.isAvailable()).toBe(true);
    });

    it('returns true when gnome-screenshot is found', async () => {
      mockCommandExists.mockImplementation(async (cmd) => cmd === 'gnome-screenshot');
      expect(await provider.isAvailable()).toBe(true);
    });
  });

  describe('captureFullscreen with maim', () => {
    beforeEach(async () => {
      mockCommandExists.mockImplementation(async (cmd) => cmd === 'maim');
      await provider.isAvailable(); // trigger detection
    });

    it('calls maim with output path', async () => {
      await provider.captureFullscreen({ outputPath: '/tmp/test.png' });
      expect(mockExecFile).toHaveBeenCalledWith('maim', ['/tmp/test.png']);
    });

    it('sleeps when delay is specified', async () => {
      await provider.captureFullscreen({ outputPath: '/tmp/test.png', delay: 2 });
      expect(mockSleep).toHaveBeenCalledWith(2);
    });
  });

  describe('captureFullscreen with scrot', () => {
    beforeEach(async () => {
      mockCommandExists.mockImplementation(async (cmd) => cmd === 'scrot');
      await provider.isAvailable();
    });

    it('calls scrot with output path', async () => {
      await provider.captureFullscreen({ outputPath: '/tmp/test.png' });
      expect(mockExecFile).toHaveBeenCalledWith('scrot', ['/tmp/test.png']);
    });
  });

  describe('captureFullscreen with gnome-screenshot', () => {
    beforeEach(async () => {
      mockCommandExists.mockImplementation(async (cmd) => cmd === 'gnome-screenshot');
      await provider.isAvailable();
    });

    it('calls gnome-screenshot with -f flag', async () => {
      await provider.captureFullscreen({ outputPath: '/tmp/test.png' });
      expect(mockExecFile).toHaveBeenCalledWith('gnome-screenshot', ['-f', '/tmp/test.png']);
    });
  });

  describe('captureFullscreen with grim', () => {
    beforeEach(async () => {
      mockCommandExists.mockImplementation(async (cmd) => cmd === 'grim');
      await provider.isAvailable();
    });

    it('calls grim with output path', async () => {
      await provider.captureFullscreen({ outputPath: '/tmp/test.png' });
      expect(mockExecFile).toHaveBeenCalledWith('grim', ['/tmp/test.png']);
    });
  });

  describe('captureRegion with maim', () => {
    beforeEach(async () => {
      mockCommandExists.mockImplementation(async (cmd) => cmd === 'maim');
      await provider.isAvailable();
    });

    it('calls maim with -g geometry flag', async () => {
      await provider.captureRegion({
        outputPath: '/tmp/test.png',
        x: 100, y: 200, width: 800, height: 600,
      });
      expect(mockExecFile).toHaveBeenCalledWith('maim', ['-g', '800x600+100+200', '/tmp/test.png']);
    });
  });

  describe('captureRegion with grim', () => {
    beforeEach(async () => {
      mockCommandExists.mockImplementation(async (cmd) => cmd === 'grim');
      await provider.isAvailable();
    });

    it('calls grim with -g geometry', async () => {
      await provider.captureRegion({
        outputPath: '/tmp/test.png',
        x: 10, y: 20, width: 400, height: 300,
      });
      expect(mockExecFile).toHaveBeenCalledWith('grim', ['-g', '10,20 400x300', '/tmp/test.png']);
    });
  });

  describe('captureRegion with gnome-screenshot', () => {
    beforeEach(async () => {
      mockCommandExists.mockImplementation(async (cmd) => cmd === 'gnome-screenshot');
      await provider.isAvailable();
    });

    it('throws because gnome-screenshot does not support region coordinates', async () => {
      await expect(
        provider.captureRegion({
          outputPath: '/tmp/test.png',
          x: 0, y: 0, width: 100, height: 100,
        })
      ).rejects.toThrow('gnome-screenshot does not support region capture');
    });
  });

  describe('captureWindow with maim', () => {
    beforeEach(async () => {
      mockCommandExists.mockImplementation(async (cmd) => cmd === 'maim');
      await provider.isAvailable();
    });

    it('calls maim with -i flag when windowId is provided as string from xdotool', async () => {
      // When windowId is provided directly
      await provider.captureWindow({ outputPath: '/tmp/test.png', windowId: 12345 });
      expect(mockExecFile).toHaveBeenCalledWith('maim', ['-i', '12345', '/tmp/test.png']);
    });

    it('uses xdotool to find window by name', async () => {
      // Make both maim and xdotool detected.
      mockCommandExists.mockImplementation(async (cmd) => cmd === 'maim' || cmd === 'xdotool');
      // Mock xdotool response
      mockExecFile.mockResolvedValueOnce({ stdout: '67890\n', stderr: '' });

      await provider.captureWindow({ outputPath: '/tmp/test.png', windowName: 'Firefox' });

      // First call: xdotool search
      expect(mockExecFile).toHaveBeenCalledWith('xdotool', ['search', '--name', 'Firefox']);
      // Second call: maim with the found window ID
      expect(mockExecFile).toHaveBeenCalledWith('maim', ['-i', '67890', '/tmp/test.png']);
    });

    it('throws a helpful install hint when xdotool is missing', async () => {
      // maim available but xdotool is not.
      mockCommandExists.mockImplementation(async (cmd) => cmd === 'maim');

      await expect(
        provider.captureWindow({ outputPath: '/tmp/test.png', windowName: 'Firefox' }),
      ).rejects.toThrow(/xdotool.*not installed.*sudo apt install xdotool/s);
    });
  });

  describe('captureWindow with grim', () => {
    beforeEach(async () => {
      mockCommandExists.mockImplementation(async (cmd) => cmd === 'grim');
      await provider.isAvailable();
    });

    it('throws because grim does not support window capture', async () => {
      await expect(
        provider.captureWindow({ outputPath: '/tmp/test.png', windowName: 'Firefox' })
      ).rejects.toThrow('Window capture is not supported on Wayland');
    });
  });

  describe('no backend available', () => {
    it('throws an error with a distro-specific install hint', async () => {
      mockCommandExists.mockResolvedValue(false);

      await expect(
        provider.captureFullscreen({ outputPath: '/tmp/test.png' }),
      ).rejects.toThrow(/No screenshot tool found.*sudo apt install maim xdotool/s);
    });
  });

  describe('includeCursor (unsupported on Linux)', () => {
    beforeEach(async () => {
      mockCommandExists.mockImplementation(async (cmd) => cmd === 'maim');
      await provider.isAvailable();
    });

    it('throws on captureFullscreen when includeCursor is true', async () => {
      await expect(
        provider.captureFullscreen({ outputPath: '/tmp/test.png', includeCursor: true })
      ).rejects.toThrow('Linux provider does not support includeCursor');
    });

    it('throws on captureWindow when includeCursor is true', async () => {
      await expect(
        provider.captureWindow({ outputPath: '/tmp/test.png', windowId: 1, includeCursor: true })
      ).rejects.toThrow('Linux provider does not support includeCursor');
    });

    it('throws on captureRegion when includeCursor is true', async () => {
      await expect(
        provider.captureRegion({
          outputPath: '/tmp/test.png',
          x: 0, y: 0, width: 100, height: 100,
          includeCursor: true,
        })
      ).rejects.toThrow('Linux provider does not support includeCursor');
    });

    it('does NOT throw when includeCursor is unset or false', async () => {
      await expect(
        provider.captureFullscreen({ outputPath: '/tmp/test.png' })
      ).resolves.not.toThrow();
      await expect(
        provider.captureFullscreen({ outputPath: '/tmp/test.png', includeCursor: false })
      ).resolves.not.toThrow();
    });
  });
});
