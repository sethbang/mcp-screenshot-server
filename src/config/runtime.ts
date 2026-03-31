
import { Semaphore } from '../utils/semaphore.js';
import { MAX_CONCURRENT_SCREENSHOTS, homeDir, configuredOutDir } from './index.js';
import { mkdirSync } from 'fs';

export { homeDir };

/**
 * Default output directory for screenshots.
 * Configurable via SCREENSHOT_OUTPUT_DIR environment variable.
 * Falls back to ~/Documents/screenshots, then ~/Desktop/Screenshots.
 */
export const defaultOutDir = configuredOutDir;

// SINGLETON — the only Semaphore instance in the entire codebase
export const puppeteerSemaphore = new Semaphore(MAX_CONCURRENT_SCREENSHOTS);

// Lazy directory creation — called by tools on first use, not at import
let _defaultDirCreated = false;
export function ensureDefaultDirectory(): void {
  if (!_defaultDirCreated) {
    mkdirSync(defaultOutDir, { recursive: true });
    _defaultDirCreated = true;
  }
}
