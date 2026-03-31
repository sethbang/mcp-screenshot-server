// ============================================================================
// Configuration Constants
// ============================================================================

import { join } from 'path';

/**
 * Maximum number of concurrent Puppeteer browser instances.
 * Each instance spawns a Chromium process consuming 100-500MB of memory.
 * SEC-005: Prevents resource exhaustion / DoS attacks.
 */
export const MAX_CONCURRENT_SCREENSHOTS = 3;

/**
 * Resolved allowed output directories for screenshots.
 * Only these directories (and their subdirectories) are permitted for file output.
 * Uses process.env.HOME at module load time (pure computation, no I/O side effects).
 */
export const homeDir = process.env.HOME || '/tmp';

/**
 * Resolved default output directory for screenshots.
 * Priority: 1) SCREENSHOT_OUTPUT_DIR env var  2) ~/Documents/screenshots  3) ~/Desktop/Screenshots
 */
export const configuredOutDir = process.env.SCREENSHOT_OUTPUT_DIR
  ? join(homeDir, process.env.SCREENSHOT_OUTPUT_DIR.replace(/^~\/?/, ''))
  : join(homeDir, 'Documents', 'screenshots');

export const ALLOWED_OUTPUT_DIRS: readonly string[] = [
  join(homeDir, 'Desktop', 'Screenshots'), // ~/Desktop/Screenshots (original default)
  configuredOutDir,                         // Configured default output directory
  '/tmp',                                   // System temp directory
  join(homeDir, 'Downloads'),               // ~/Downloads
  join(homeDir, 'Documents'),               // ~/Documents
];

/**
 * Regex for validating macOS application names used in window-capture mode.
 * Only allows alphanumeric characters, spaces, hyphens, and underscores
 * to prevent command injection in Swift code execution.
 */
export const SAFE_APP_NAME_PATTERN = /^[a-zA-Z0-9 \-_]+$/;
