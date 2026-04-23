import { promises as fsPromises } from 'fs';
import { dirname, join, resolve, relative, isAbsolute } from 'path';
import type { PathValidationResult } from '../types/index.js';

/** Injectable filesystem for testing (symlink resolution). */
export interface FileSystem {
  realpath(path: string): Promise<string>;
}

/** Configuration for allowed output directories. */
export interface PathConfig {
  allowedOutputDirs: readonly string[];
  defaultOutDir: string;
}

const defaultFileSystem: FileSystem = {
  realpath: (path) => fsPromises.realpath(path),
};

/**
 * Validate an output path to prevent path traversal attacks (SEC-004).
 * Uses fs.realpath() to resolve symlinks, preventing TOCTOU attacks.
 */
export async function validateOutputPath(
  customPath: string | undefined,
  defaultName: string,
  config: PathConfig,
  fileSystem: FileSystem = defaultFileSystem,
): Promise<PathValidationResult> {
  // Treat undefined, empty, or whitespace-only as "no custom path"
  if (!customPath || customPath.trim() === '') {
    // No custom path - use default directory (always safe)
    return { valid: true, path: join(config.defaultOutDir, defaultName) };
  }

  // Reject null bytes (path injection vector)
  if (customPath.includes('\x00') || customPath.includes('%00')) {
    return { valid: false, error: 'Path contains null bytes' };
  }

  // First resolve to absolute form
  let targetPath: string;
  if (customPath.startsWith('/')) {
    targetPath = resolve(customPath);
  } else {
    // Relative paths resolved against defaultOutDir
    targetPath = resolve(config.defaultOutDir, customPath);
  }

  // SEC-004: Resolve symlinks to get the REAL path
  // This prevents attackers from using symlinks to bypass directory restrictions
  let realPath: string;
  try {
    // Try to resolve the full path (works if file/symlink already exists)
    realPath = await fileSystem.realpath(targetPath);
  } catch {
    // Path doesn't exist yet - resolve the parent directory's symlinks
    // This handles the case where we're writing a new file
    const parentDir = dirname(targetPath);
    const fileName = targetPath.substring(parentDir.length + 1);
    try {
      const realParent = await fileSystem.realpath(parentDir);
      realPath = join(realParent, fileName);
    } catch {
      // Parent directory doesn't exist either - fail closed
      return { valid: false, error: `Parent directory does not exist: ${parentDir}` };
    }
  }

  // Check if the REAL path (with symlinks resolved) is within any allowed directory
  // Also resolve symlinks in allowed directories for consistent comparison
  for (const allowedDir of config.allowedOutputDirs) {
    let realAllowedDir: string;
    try {
      realAllowedDir = await fileSystem.realpath(allowedDir);
    } catch {
      // Allowed directory doesn't exist, use resolved form
      realAllowedDir = resolve(allowedDir);
    }

    const relativePath = relative(realAllowedDir, realPath);

    // isAbsolute() catches the cross-drive case on Windows, where relative() returns
    // an absolute path like 'D:\\foo' that doesn't start with '/' or '..'.
    if (!relativePath.startsWith('..') && !isAbsolute(relativePath)) {
      return { valid: true, path: realPath };
    }
  }

  // Path is outside all allowed directories (after symlink resolution)
  return {
    valid: false,
    error: 'Output path must be within allowed directories (~/Desktop/Screenshots, ~/Documents, ~/Downloads, or the system temp directory). Symlinks to other locations are not permitted.',
  };
}
