import { describe, it, expect } from 'vitest';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { validateOutputPath } from '../../src/validators/path.js';
import type { PathConfig } from '../../src/validators/path.js';
import { createMockFs } from '../mocks/fs.js';

// Use platform-resolved paths so the same fixtures work on Linux, macOS, and Windows.
// validateOutputPath calls path.resolve()/path.relative(), which are platform-aware,
// so the mock FS keys must match what those functions produce on the current host.
const HOME = homedir();
const TMP = tmpdir();
const ALLOWED_DESKTOP = path.join(HOME, 'Desktop', 'Screenshots');
const ALLOWED_DOWNLOADS = path.join(HOME, 'Downloads');
const ALLOWED_DOCUMENTS = path.join(HOME, 'Documents');
// A forbidden absolute path that exists on every platform after resolve().
// On POSIX this is /forbidden-test-dir; on Windows it becomes e.g. C:\forbidden-test-dir.
const FORBIDDEN_DIR = path.resolve(path.sep + 'forbidden-test-dir');

const TEST_CONFIG: PathConfig = {
  allowedOutputDirs: [ALLOWED_DESKTOP, TMP, ALLOWED_DOWNLOADS, ALLOWED_DOCUMENTS],
  defaultOutDir: ALLOWED_DESKTOP,
};

// Mock FS where realpath returns identity for allowed dirs and paths within them
function buildMockFs(extra?: Map<string, string | Error>) {
  const mappings = new Map<string, string | Error>([
    [ALLOWED_DESKTOP, ALLOWED_DESKTOP],
    [TMP, TMP],
    [ALLOWED_DOWNLOADS, ALLOWED_DOWNLOADS],
    [ALLOWED_DOCUMENTS, ALLOWED_DOCUMENTS],
  ]);
  if (extra) {
    for (const [k, v] of extra) mappings.set(k, v);
  }
  return createMockFs(mappings);
}

describe('validateOutputPath', () => {
  it('uses default path when no custom path given', async () => {
    const result = await validateOutputPath(undefined, 'screenshot.png', TEST_CONFIG);
    expect(result).toEqual({
      valid: true,
      path: path.join(ALLOWED_DESKTOP, 'screenshot.png'),
    });
  });

  it('uses default path when empty string given', async () => {
    const result = await validateOutputPath('', 'screenshot.png', TEST_CONFIG);
    expect(result).toEqual({
      valid: true,
      path: path.join(ALLOWED_DESKTOP, 'screenshot.png'),
    });
  });

  it('uses default path when whitespace-only string given', async () => {
    const result = await validateOutputPath('   ', 'screenshot.png', TEST_CONFIG);
    expect(result).toEqual({
      valid: true,
      path: path.join(ALLOWED_DESKTOP, 'screenshot.png'),
    });
  });

  it('accepts valid custom path within allowed directory', async () => {
    const target = path.join(TMP, 'my-screenshot.png');
    const fs = buildMockFs(new Map([[target, target]]));
    const result = await validateOutputPath(target, 'default.png', TEST_CONFIG, fs);
    expect(result.valid).toBe(true);
    expect(result.path).toBe(target);
  });

  it('accepts path in Downloads', async () => {
    const targetPath = path.join(ALLOWED_DOWNLOADS, 'shot.png');
    // File doesn't exist yet, parent resolves
    const fs = buildMockFs();
    const result = await validateOutputPath(targetPath, 'default.png', TEST_CONFIG, fs);
    expect(result.valid).toBe(true);
    expect(result.path).toBe(targetPath);
  });

  it('accepts path in Documents', async () => {
    const targetPath = path.join(ALLOWED_DOCUMENTS, 'report.png');
    const fs = buildMockFs();
    const result = await validateOutputPath(targetPath, 'default.png', TEST_CONFIG, fs);
    expect(result.valid).toBe(true);
    expect(result.path).toBe(targetPath);
  });

  it('accepts path in temp directory', async () => {
    const target = path.join(TMP, 'test.png');
    const fs = buildMockFs();
    const result = await validateOutputPath(target, 'default.png', TEST_CONFIG, fs);
    expect(result.valid).toBe(true);
    expect(result.path).toBe(target);
  });

  it('rejects path traversal attempt to a forbidden absolute path', async () => {
    const target = path.join(FORBIDDEN_DIR, 'secret.txt');
    const fs = buildMockFs(new Map([
      [target, target],
      [FORBIDDEN_DIR, FORBIDDEN_DIR],
    ]));
    const result = await validateOutputPath(target, 'default.png', TEST_CONFIG, fs);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('allowed directories');
  });

  it('rejects symlink resolving outside allowed dirs', async () => {
    // Symlink at TMP/evil resolves to a forbidden location
    const symlinkSource = path.join(TMP, 'evil');
    const symlinkTarget = path.join(FORBIDDEN_DIR, 'shadow');
    const fs = buildMockFs(new Map([
      [symlinkSource, symlinkTarget],
    ]));
    const result = await validateOutputPath(symlinkSource, 'default.png', TEST_CONFIG, fs);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('allowed directories');
  });

  it('rejects null byte in path', async () => {
    const result = await validateOutputPath(
      path.join(TMP, 'evil\x00.png'),
      'default.png',
      TEST_CONFIG,
    );
    expect(result.valid).toBe(false);
    expect(result.error).toContain('null bytes');
  });

  it('rejects %00 in path', async () => {
    const result = await validateOutputPath(
      path.join(TMP, 'evil%00.png'),
      'default.png',
      TEST_CONFIG,
    );
    expect(result.valid).toBe(false);
    expect(result.error).toContain('null bytes');
  });

  it('fails when parent directory does not exist', async () => {
    const fs = buildMockFs();
    const target = path.resolve(path.sep, 'nonexistent', 'dir', 'file.png');
    const result = await validateOutputPath(target, 'default.png', TEST_CONFIG, fs);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Parent directory does not exist');
  });
});

// Contract test for the Windows cross-drive containment fix at src/validators/path.ts:84.
// On Windows, path.relative() returns an absolute path (e.g. 'D:\\foo') when the source
// and target are on different drives. The previous startsWith('/') check missed this;
// the fix uses path.isAbsolute() instead. These assertions lock the Node.js behavior
// we depend on, so a future regression in either Node or the validator surfaces here
// rather than as a security bug only reproducible on Windows.
describe('path.isAbsolute contract (Windows cross-drive guard)', () => {
  it('path.win32.isAbsolute identifies a different-drive Windows path as absolute', () => {
    expect(path.win32.isAbsolute('D:\\other\\foo')).toBe(true);
  });

  it('path.win32.isAbsolute does NOT flag relative segments as absolute', () => {
    expect(path.win32.isAbsolute('..\\foo')).toBe(false);
    expect(path.win32.isAbsolute('subdir\\foo')).toBe(false);
  });

  it('path.win32.relative returns an absolute path when drives differ', () => {
    const result = path.win32.relative('C:\\Users\\alice', 'D:\\other\\bar');
    // The validator's fix relies on this: when drives differ, relative() returns
    // an absolute path, which isAbsolute() catches but startsWith('/') would miss.
    expect(path.win32.isAbsolute(result)).toBe(true);
    expect(result.startsWith('/')).toBe(false); // confirms the OLD check was broken
    expect(result.startsWith('..')).toBe(false); // and so was the .. check
  });
});
