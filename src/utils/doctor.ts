// ============================================================================
// Diagnostic runner for `universal-screenshot-mcp --doctor`
//
// Probes the host system and reports whether the screenshot tools needed by
// take_system_screenshot are present, with copy-pasteable install commands
// for any that are missing.
// ============================================================================

import { commandExists } from './screenshot-provider.js';
import { detectLinuxDistro, getInstallCommand, RECOMMENDED_X11_PACKAGES } from './linux-deps.js';

export type CheckStatus = 'ok' | 'warn' | 'fail';

export interface DoctorCheck {
  name: string;
  status: CheckStatus;
  detail: string;
  /** Copy-pasteable remediation, when applicable. */
  hint?: string;
}

export interface DoctorReport {
  platform: string;
  nodeVersion: string;
  checks: DoctorCheck[];
  hasFailures: boolean;
  hasWarnings: boolean;
}

const LINUX_BACKENDS = [
  'maim', 'scrot', 'gnome-screenshot', 'spectacle', 'grim', 'import',
] as const;

export async function runDoctor(
  platform: NodeJS.Platform | string = process.platform,
): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];

  if (platform === 'darwin') {
    checks.push(await checkMacOS());
  } else if (platform === 'linux') {
    checks.push(...(await checkLinux()));
  } else if (platform === 'win32') {
    checks.push(await checkWindows());
  } else {
    checks.push({
      name: 'Platform support',
      status: 'fail',
      detail: `Unsupported platform: ${platform}. Supported: darwin, linux, win32.`,
    });
  }

  return {
    platform,
    nodeVersion: process.version,
    checks,
    hasFailures: checks.some(c => c.status === 'fail'),
    hasWarnings: checks.some(c => c.status === 'warn'),
  };
}

async function checkMacOS(): Promise<DoctorCheck> {
  if (await commandExists('screencapture')) {
    return {
      name: 'macOS screencapture',
      status: 'ok',
      detail: 'screencapture is available (built-in on macOS).',
    };
  }
  return {
    name: 'macOS screencapture',
    status: 'fail',
    detail: 'screencapture is missing — this is unexpected on macOS.',
  };
}

async function checkWindows(): Promise<DoctorCheck> {
  if (await commandExists('powershell')) {
    return {
      name: 'Windows PowerShell',
      status: 'ok',
      detail: 'powershell is available (built-in on Windows).',
    };
  }
  return {
    name: 'Windows PowerShell',
    status: 'fail',
    detail: 'powershell is missing — this is unexpected on Windows.',
  };
}

async function checkLinux(): Promise<DoctorCheck[]> {
  const distro = await detectLinuxDistro();

  const found: string[] = [];
  for (const tool of LINUX_BACKENDS) {
    if (await commandExists(tool)) found.push(tool);
  }

  const checks: DoctorCheck[] = [];

  checks.push({
    name: 'Linux distro',
    status: 'ok',
    detail: distro.id === 'unknown'
      ? 'Could not identify distro from /etc/os-release; install commands will be generic.'
      : `Detected ${distro.id} (package manager: ${distro.packageManager}).`,
  });

  if (found.length === 0) {
    checks.push({
      name: 'Screenshot backend',
      status: 'fail',
      detail: 'No screenshot tool found. take_system_screenshot will not work.',
      hint: getInstallCommand(distro.packageManager, [...RECOMMENDED_X11_PACKAGES]),
    });
  } else {
    checks.push({
      name: 'Screenshot backend',
      status: 'ok',
      detail: `Found: ${found.join(', ')}. Will use ${found[0]} (highest priority).`,
    });
  }

  if (await commandExists('xdotool')) {
    checks.push({
      name: 'xdotool (window-by-name)',
      status: 'ok',
      detail: 'xdotool is installed — windowName capture supported.',
    });
  } else {
    checks.push({
      name: 'xdotool (window-by-name)',
      status: 'warn',
      detail: 'xdotool is not installed — windowName capture will fail; windowId still works.',
      hint: getInstallCommand(distro.packageManager, ['xdotool']),
    });
  }

  return checks;
}

const STATUS_GLYPH: Record<CheckStatus, string> = {
  ok:   '[OK]  ',
  warn: '[WARN]',
  fail: '[FAIL]',
};

export function formatDoctorReport(report: DoctorReport): string {
  const lines: string[] = [];
  lines.push('universal-screenshot-mcp doctor');
  lines.push('');
  lines.push(`Platform:  ${report.platform}`);
  lines.push(`Node:      ${report.nodeVersion}`);
  lines.push('');
  for (const check of report.checks) {
    lines.push(`${STATUS_GLYPH[check.status]} ${check.name}`);
    lines.push(`        ${check.detail}`);
    if (check.hint) {
      lines.push(`        → ${check.hint}`);
    }
    lines.push('');
  }
  if (report.hasFailures) {
    lines.push('Result: FAILED — see hints above.');
  } else if (report.hasWarnings) {
    lines.push('Result: OK with warnings — some optional features need extra setup.');
  } else {
    lines.push('Result: OK — all checks passed.');
  }
  return lines.join('\n');
}
