/**
 * Integration tests for path validation with real filesystem operations.
 *
 * These tests create real directories and symlinks in /tmp, then exercise
 * validateOutputPath with the default FileSystem (real fs.realpath).
 * Unit tests mock the entire filesystem via the FileSystem injection point.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { validateOutputPath } from '../../src/validators/path.js';
import { createTempTestDir, type TempTestDir } from '../helpers/temp-dir.js';

let tmp: TempTestDir;

beforeAll(async () => {
  tmp = await createTempTestDir();
});

afterAll(async () => {
  await tmp.cleanup();
});

const defaultName = 'screenshot.png';

describe('validateOutputPath — real filesystem', () => {
  it('accepts a path within the allowed directory', async () => {
    const config = { allowedOutputDirs: [tmp.allowed], defaultOutDir: tmp.allowed };
    const result = await validateOutputPath(
      `${tmp.allowed}/screenshot.png`,
      defaultName,
      config,
    );
    expect(result.valid).toBe(true);
    expect(result.path).toContain(tmp.allowed);
  });

  it('accepts a path through a symlink that stays within allowed dirs', async () => {
    const config = { allowedOutputDirs: [tmp.allowed], defaultOutDir: tmp.allowed };
    // legit-link → allowed/sub/ (stays within allowed tree)
    const result = await validateOutputPath(
      `${tmp.allowed}/legit-link/screenshot.png`,
      defaultName,
      config,
    );
    expect(result.valid).toBe(true);
    // The real path should be under allowed/sub/
    expect(result.path).toContain('sub');
  });

  it('rejects a path through a symlink that escapes to forbidden dir', async () => {
    const config = { allowedOutputDirs: [tmp.allowed], defaultOutDir: tmp.allowed };
    // escape-link → forbidden/ (outside allowed tree)
    const result = await validateOutputPath(
      `${tmp.allowed}/escape-link/screenshot.png`,
      defaultName,
      config,
    );
    expect(result.valid).toBe(false);
    expect(result.error).toContain('allowed directories');
  });

  it('rejects ../ path traversal', async () => {
    const config = { allowedOutputDirs: [tmp.allowed], defaultOutDir: tmp.allowed };
    const result = await validateOutputPath(
      `${tmp.allowed}/../../etc/passwd`,
      defaultName,
      config,
    );
    expect(result.valid).toBe(false);
  });

  it('rejects path with non-existent nested parent', async () => {
    const config = { allowedOutputDirs: [tmp.allowed], defaultOutDir: tmp.allowed };
    const result = await validateOutputPath(
      `${tmp.allowed}/nonexistent/deep/nested/screenshot.png`,
      defaultName,
      config,
    );
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Parent directory does not exist');
  });

  it('rejects null byte injection', async () => {
    const config = { allowedOutputDirs: [tmp.allowed], defaultOutDir: tmp.allowed };
    const result = await validateOutputPath(
      `${tmp.allowed}/screenshot\x00.png`,
      defaultName,
      config,
    );
    expect(result.valid).toBe(false);
    expect(result.error).toContain('null bytes');
  });

  it('uses default directory when no custom path given', async () => {
    const config = { allowedOutputDirs: [tmp.allowed], defaultOutDir: tmp.allowed };
    const result = await validateOutputPath(undefined, defaultName, config);
    expect(result.valid).toBe(true);
    expect(result.path).toBe(`${tmp.allowed}/${defaultName}`);
  });

  it('resolves relative paths against defaultOutDir', async () => {
    const config = { allowedOutputDirs: [tmp.allowed], defaultOutDir: tmp.allowed };
    const result = await validateOutputPath('myfile.png', defaultName, config);
    expect(result.valid).toBe(true);
    expect(result.path).toContain(tmp.allowed);
    expect(result.path).toContain('myfile.png');
  });
});
