import { describe, it, expect } from 'vitest';
import {
  parseOsRelease,
  detectLinuxDistro,
  getInstallCommand,
} from '../../src/utils/linux-deps.js';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('parseOsRelease', () => {
  it('parses Ubuntu and infers apt', () => {
    const content = [
      'NAME="Ubuntu"',
      'ID=ubuntu',
      'ID_LIKE=debian',
      'PRETTY_NAME="Ubuntu 22.04 LTS"',
    ].join('\n');
    const info = parseOsRelease(content);
    expect(info.id).toBe('ubuntu');
    expect(info.idLike).toEqual(['debian']);
    expect(info.packageManager).toBe('apt');
  });

  it('parses Fedora and infers dnf', () => {
    const info = parseOsRelease('ID=fedora\nVERSION_ID=39\n');
    expect(info.id).toBe('fedora');
    expect(info.packageManager).toBe('dnf');
  });

  it('parses Arch and infers pacman', () => {
    const info = parseOsRelease('ID=arch\nNAME="Arch Linux"\n');
    expect(info.id).toBe('arch');
    expect(info.packageManager).toBe('pacman');
  });

  it('parses openSUSE Tumbleweed and infers zypper', () => {
    const info = parseOsRelease('ID="opensuse-tumbleweed"\nID_LIKE="suse opensuse"\n');
    expect(info.id).toBe('opensuse-tumbleweed');
    expect(info.packageManager).toBe('zypper');
  });

  it('parses Alpine and infers apk', () => {
    const info = parseOsRelease('ID=alpine\n');
    expect(info.packageManager).toBe('apk');
  });

  it('falls back to ID_LIKE when ID is unknown but a parent matches', () => {
    // A Debian derivative not in our hardcoded list.
    const info = parseOsRelease('ID=fictionaldistro\nID_LIKE=debian\n');
    expect(info.id).toBe('fictionaldistro');
    expect(info.packageManager).toBe('apt');
  });

  it('returns "unknown" when neither ID nor ID_LIKE is recognized', () => {
    const info = parseOsRelease('ID=something-strange\n');
    expect(info.packageManager).toBe('unknown');
  });

  it('handles empty content gracefully', () => {
    const info = parseOsRelease('');
    expect(info.id).toBe('unknown');
    expect(info.idLike).toEqual([]);
    expect(info.packageManager).toBe('unknown');
  });

  it('strips both single and double quotes from values', () => {
    const info = parseOsRelease(`ID='ubuntu'\nID_LIKE="debian"\n`);
    expect(info.id).toBe('ubuntu');
    expect(info.idLike).toEqual(['debian']);
  });
});

describe('detectLinuxDistro', () => {
  it('returns the unknown record when the file does not exist', async () => {
    const info = await detectLinuxDistro(join(tmpdir(), 'nope-does-not-exist-xyz'));
    expect(info.id).toBe('unknown');
    expect(info.packageManager).toBe('unknown');
  });

  it('reads and parses a real file from disk', async () => {
    const tmpPath = join(tmpdir(), `os-release-${Date.now()}-${Math.random()}.txt`);
    await fs.writeFile(tmpPath, 'ID=fedora\nVERSION_ID=40\n', 'utf8');
    try {
      const info = await detectLinuxDistro(tmpPath);
      expect(info.id).toBe('fedora');
      expect(info.packageManager).toBe('dnf');
    } finally {
      await fs.unlink(tmpPath).catch(() => undefined);
    }
  });
});

describe('getInstallCommand', () => {
  const pkgs = ['maim', 'xdotool'];

  it('formats apt commands', () => {
    expect(getInstallCommand('apt', pkgs)).toBe('sudo apt install maim xdotool');
  });

  it('formats dnf commands', () => {
    expect(getInstallCommand('dnf', pkgs)).toBe('sudo dnf install maim xdotool');
  });

  it('formats pacman commands with -S', () => {
    expect(getInstallCommand('pacman', pkgs)).toBe('sudo pacman -S maim xdotool');
  });

  it('formats zypper commands', () => {
    expect(getInstallCommand('zypper', pkgs)).toBe('sudo zypper install maim xdotool');
  });

  it('formats apk commands with add', () => {
    expect(getInstallCommand('apk', pkgs)).toBe('sudo apk add maim xdotool');
  });

  it('returns a generic instruction for unknown package manager', () => {
    expect(getInstallCommand('unknown', pkgs)).toContain('maim xdotool');
    expect(getInstallCommand('unknown', pkgs)).toMatch(/package manager/i);
  });
});
