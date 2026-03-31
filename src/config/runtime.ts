
import { Semaphore } from '../utils/semaphore.js';
import { MAX_CONCURRENT_SCREENSHOTS, homeDir } from './index.js';
import { mkdirSync } from 'fs';
import { join } from 'path';

export { homeDir };
export const defaultOutDir = join(homeDir, 'Documents', 'screenshots');

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
