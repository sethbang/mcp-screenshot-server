import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/utils/screenshot-provider.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/utils/screenshot-provider.js')>();
  return {
    ...original,
    commandExists: vi.fn().mockResolvedValue(false),
  };
});

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

import { runDoctor, formatDoctorReport } from '../../src/utils/doctor.js';
import { commandExists } from '../../src/utils/screenshot-provider.js';
import { detectLinuxDistro } from '../../src/utils/linux-deps.js';

const mockCommandExists = vi.mocked(commandExists);
const mockDetectDistro = vi.mocked(detectLinuxDistro);

describe('runDoctor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDetectDistro.mockResolvedValue({
      id: 'ubuntu',
      idLike: ['debian'],
      packageManager: 'apt',
    });
  });

  describe('macOS', () => {
    it('reports OK when screencapture is present', async () => {
      mockCommandExists.mockResolvedValue(true);
      const report = await runDoctor('darwin');
      expect(report.platform).toBe('darwin');
      expect(report.checks).toHaveLength(1);
      expect(report.checks[0].status).toBe('ok');
      expect(report.hasFailures).toBe(false);
    });

    it('reports FAIL when screencapture is missing', async () => {
      mockCommandExists.mockResolvedValue(false);
      const report = await runDoctor('darwin');
      expect(report.checks[0].status).toBe('fail');
      expect(report.hasFailures).toBe(true);
    });
  });

  describe('Windows', () => {
    it('reports OK when powershell is present', async () => {
      mockCommandExists.mockResolvedValue(true);
      const report = await runDoctor('win32');
      expect(report.checks[0].status).toBe('ok');
      expect(report.hasFailures).toBe(false);
    });

    it('reports FAIL when powershell is missing', async () => {
      mockCommandExists.mockResolvedValue(false);
      const report = await runDoctor('win32');
      expect(report.checks[0].status).toBe('fail');
    });
  });

  describe('Linux', () => {
    it('reports OK and lists found backends when tools are present', async () => {
      mockCommandExists.mockImplementation(async (cmd) => cmd === 'maim' || cmd === 'xdotool');
      const report = await runDoctor('linux');
      expect(report.hasFailures).toBe(false);
      expect(report.hasWarnings).toBe(false);

      const backendCheck = report.checks.find(c => c.name === 'Screenshot backend');
      expect(backendCheck?.status).toBe('ok');
      expect(backendCheck?.detail).toContain('maim');

      const xdotoolCheck = report.checks.find(c => c.name.startsWith('xdotool'));
      expect(xdotoolCheck?.status).toBe('ok');
    });

    it('reports FAIL with a distro-specific install hint when no backend is found', async () => {
      mockCommandExists.mockResolvedValue(false);
      const report = await runDoctor('linux');

      const backendCheck = report.checks.find(c => c.name === 'Screenshot backend');
      expect(backendCheck?.status).toBe('fail');
      expect(backendCheck?.hint).toBe('sudo apt install maim xdotool');
      expect(report.hasFailures).toBe(true);
    });

    it('reports WARN for missing xdotool when a backend is otherwise present', async () => {
      mockCommandExists.mockImplementation(async (cmd) => cmd === 'maim');
      const report = await runDoctor('linux');

      const xdotoolCheck = report.checks.find(c => c.name.startsWith('xdotool'));
      expect(xdotoolCheck?.status).toBe('warn');
      expect(xdotoolCheck?.hint).toBe('sudo apt install xdotool');
      expect(report.hasFailures).toBe(false);
      expect(report.hasWarnings).toBe(true);
    });

    it('uses the unknown package manager when distro detection fails', async () => {
      mockDetectDistro.mockResolvedValue({ id: 'unknown', idLike: [], packageManager: 'unknown' });
      mockCommandExists.mockResolvedValue(false);
      const report = await runDoctor('linux');
      const backendCheck = report.checks.find(c => c.name === 'Screenshot backend');
      expect(backendCheck?.hint).toMatch(/package manager/i);
      expect(backendCheck?.hint).toContain('maim xdotool');
    });

    it('uses pacman commands on Arch', async () => {
      mockDetectDistro.mockResolvedValue({ id: 'arch', idLike: [], packageManager: 'pacman' });
      mockCommandExists.mockResolvedValue(false);
      const report = await runDoctor('linux');
      const backendCheck = report.checks.find(c => c.name === 'Screenshot backend');
      expect(backendCheck?.hint).toBe('sudo pacman -S maim xdotool');
    });
  });

  it('reports FAIL on unsupported platforms', async () => {
    const report = await runDoctor('freebsd');
    expect(report.checks[0].status).toBe('fail');
    expect(report.checks[0].detail).toContain('freebsd');
    expect(report.hasFailures).toBe(true);
  });
});

describe('formatDoctorReport', () => {
  it('renders a passing report with [OK] markers', () => {
    const text = formatDoctorReport({
      platform: 'linux',
      nodeVersion: 'v20.0.0',
      checks: [
        { name: 'Linux distro', status: 'ok', detail: 'Detected ubuntu (apt).' },
        { name: 'Screenshot backend', status: 'ok', detail: 'Found: maim.' },
      ],
      hasFailures: false,
      hasWarnings: false,
    });
    expect(text).toContain('[OK]');
    expect(text).toContain('all checks passed');
    expect(text).toContain('Platform:  linux');
  });

  it('renders failures and includes hints', () => {
    const text = formatDoctorReport({
      platform: 'linux',
      nodeVersion: 'v20.0.0',
      checks: [
        {
          name: 'Screenshot backend',
          status: 'fail',
          detail: 'No screenshot tool found.',
          hint: 'sudo apt install maim xdotool',
        },
      ],
      hasFailures: true,
      hasWarnings: false,
    });
    expect(text).toContain('[FAIL]');
    expect(text).toContain('sudo apt install maim xdotool');
    expect(text).toContain('FAILED');
  });

  it('renders warnings distinctly from failures', () => {
    const text = formatDoctorReport({
      platform: 'linux',
      nodeVersion: 'v20.0.0',
      checks: [
        {
          name: 'xdotool',
          status: 'warn',
          detail: 'xdotool is not installed.',
          hint: 'sudo apt install xdotool',
        },
      ],
      hasFailures: false,
      hasWarnings: true,
    });
    expect(text).toContain('[WARN]');
    expect(text).toContain('OK with warnings');
    expect(text).not.toContain('FAILED');
  });
});
