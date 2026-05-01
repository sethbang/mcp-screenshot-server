// ============================================================================
// Linux distro detection + package install command formatting
//
// Used by linux-provider runtime errors, the --doctor subcommand, and the
// startup stderr warning so all three surfaces produce the same actionable
// install instructions.
// ============================================================================

import { readFile } from 'node:fs/promises';

export type PackageManager = 'apt' | 'dnf' | 'pacman' | 'zypper' | 'apk' | 'unknown';

export interface DistroInfo {
  /** Lowercase ID from /etc/os-release (e.g. "ubuntu", "fedora", "arch"). */
  id: string;
  /** Lowercase ID_LIKE list from /etc/os-release (e.g. ["debian"] for Ubuntu). */
  idLike: string[];
  /** Package manager inferred from id/idLike, or "unknown" if not recognized. */
  packageManager: PackageManager;
}

const ID_TO_PACKAGE_MANAGER: Record<string, PackageManager> = {
  // Debian family
  debian: 'apt',
  ubuntu: 'apt',
  pop: 'apt',
  mint: 'apt',
  linuxmint: 'apt',
  kali: 'apt',
  raspbian: 'apt',
  elementary: 'apt',

  // Red Hat family
  fedora: 'dnf',
  rhel: 'dnf',
  centos: 'dnf',
  rocky: 'dnf',
  almalinux: 'dnf',
  ol: 'dnf',

  // Arch family
  arch: 'pacman',
  manjaro: 'pacman',
  endeavouros: 'pacman',
  artix: 'pacman',

  // SUSE family
  opensuse: 'zypper',
  'opensuse-leap': 'zypper',
  'opensuse-tumbleweed': 'zypper',
  sles: 'zypper',
  suse: 'zypper',

  // Alpine
  alpine: 'apk',
};

/**
 * Parse /etc/os-release content into a DistroInfo. Pure function — no I/O.
 */
export function parseOsRelease(content: string): DistroInfo {
  const fields: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const match = line.match(/^([A-Z_]+)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    fields[match[1]] = value;
  }

  const id = (fields.ID ?? 'unknown').toLowerCase();
  const idLike = (fields.ID_LIKE ?? '').toLowerCase().split(/\s+/).filter(Boolean);

  let packageManager: PackageManager = 'unknown';
  for (const candidate of [id, ...idLike]) {
    if (ID_TO_PACKAGE_MANAGER[candidate]) {
      packageManager = ID_TO_PACKAGE_MANAGER[candidate];
      break;
    }
  }

  return { id, idLike, packageManager };
}

/**
 * Read /etc/os-release and return DistroInfo. Returns an "unknown" record
 * if the file is unreadable (rare on real Linux, possible in minimal containers).
 */
export async function detectLinuxDistro(path = '/etc/os-release'): Promise<DistroInfo> {
  try {
    const content = await readFile(path, 'utf8');
    return parseOsRelease(content);
  } catch {
    return { id: 'unknown', idLike: [], packageManager: 'unknown' };
  }
}

/**
 * Build a copy-pasteable install command for the given package manager.
 * For unknown distros, returns a generic instruction listing the package names.
 */
export function getInstallCommand(packageManager: PackageManager, packages: string[]): string {
  const pkgs = packages.join(' ');
  switch (packageManager) {
    case 'apt':    return `sudo apt install ${pkgs}`;
    case 'dnf':    return `sudo dnf install ${pkgs}`;
    case 'pacman': return `sudo pacman -S ${pkgs}`;
    case 'zypper': return `sudo zypper install ${pkgs}`;
    case 'apk':    return `sudo apk add ${pkgs}`;
    case 'unknown':
    default:       return `install with your distro's package manager: ${pkgs}`;
  }
}

/**
 * Default recommendation for full take_system_screenshot support on X11 Linux.
 * Wayland users want `grim` instead — covered separately in error messages.
 */
export const RECOMMENDED_X11_PACKAGES = ['maim', 'xdotool'] as const;
