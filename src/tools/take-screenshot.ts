import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import puppeteer, { type Browser } from 'puppeteer';
import { puppeteerSemaphore, defaultOutDir, ensureDefaultDirectory } from '../config/runtime.js';
import { ALLOWED_OUTPUT_DIRS, MAX_CONCURRENT_SCREENSHOTS, ALLOW_LOCAL, SCREENSHOT_DEADLINE_MS } from '../config/index.js';
import { validateUrl } from '../validators/url.js';
import { validateOutputPath } from '../validators/path.js';
import { ok, err, timestamp, ensureDir } from '../utils/helpers.js';

// Semaphore protects expensive Puppeteer operations

/** How long a graceful browser.close() may take before the process is killed. */
const BROWSER_CLOSE_GRACE_MS = 5_000;

/**
 * Close the browser, falling back to SIGKILL if close() hangs or fails.
 * A wedged Chromium must never keep the caller (and its semaphore permit) waiting.
 */
async function shutdownBrowser(browser: Browser, force: boolean): Promise<void> {
  const proc = browser.process();
  if (!force) {
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        browser.close(),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('close timed out')), BROWSER_CLOSE_GRACE_MS); }),
      ]);
    } catch { /* browser may already be dead, or close() hung — kill below */ }
    finally { clearTimeout(timer); }
  }
  if (proc && proc.exitCode === null && proc.signalCode === null) {
    try { proc.kill('SIGKILL'); } catch { /* already gone */ }
  }
}

export function registerTakeScreenshot(server: McpServer): void {
  server.registerTool(
    'take_screenshot',
    {
      description: 'Capture web page or element via headless browser. Saves to ~/Documents/screenshots by default (configurable via SCREENSHOT_OUTPUT_DIR env var).',
      inputSchema: z.object({
        url: z.string().describe('URL to capture'),
        width: z.number().min(1).max(3840).optional().describe('Viewport width'),
        height: z.number().min(1).max(2160).optional().describe('Viewport height'),
        fullPage: z.boolean().optional().describe('Capture full page'),
        selector: z.string().optional().describe('CSS selector for element'),
        waitForSelector: z.string().optional().describe('Wait for selector'),
        waitForTimeout: z.number().min(0).max(30000).optional().describe('Delay in ms'),
        outputPath: z.string().optional().describe('Absolute path, or relative to home dir'),
      }),
    },
    async ({ url, width, height, fullPage, selector, waitForSelector, waitForTimeout, outputPath: custom }) => {
      ensureDefaultDirectory(); // Ensure the default directory exists

      // Security: Validate URL before making request (SSRF prevention)
      // Now async to support DNS resolution for DNS rebinding protection (SEC-001)
      const urlValidation = await validateUrl(url, { allowLocal: ALLOW_LOCAL });
      if (!urlValidation.valid) {
        return err(`URL validation failed: ${urlValidation.error}`);
      }

      // Security: Validate output path (path traversal prevention)
      // SEC-004: Now async to resolve symlinks before validation
      const pathValidation = await validateOutputPath(custom, `screenshot-${timestamp()}.png`, { allowedOutputDirs: ALLOWED_OUTPUT_DIRS, defaultOutDir });
      if (!pathValidation.valid) {
        return err(`Output path validation failed: ${pathValidation.error}`);
      }
      const dest = pathValidation.path!;

      // SEC-005: DoS Protection - Limit concurrent Puppeteer instances
      // Try to acquire a permit without waiting. If at capacity, reject immediately
      // rather than queuing (which would still allow memory exhaustion via queued requests).
      // Each browser instance consumes 100-500MB, so we limit to MAX_CONCURRENT_SCREENSHOTS.
      if (!puppeteerSemaphore.tryAcquire()) {
        return err(
          `Concurrent screenshot limit reached (max ${MAX_CONCURRENT_SCREENSHOTS}). ` +
          `Please wait for existing screenshots to complete.`
        );
      }

      // Declare browser outside try block to ensure cleanup in finally
      let browser: Browser | undefined;
      let timedOut = false;
      let deadlineTimer: NodeJS.Timeout | undefined;

      const capture = async () => {
        // SEC-001: IP pinning to protect against DNS rebinding attacks
        const browserArgs = [
          '--no-sandbox',
          '--disable-setuid-sandbox',
        ];
        if (urlValidation.resolvedIp && urlValidation.hostname) {
          // Chromium requires bracket notation for IPv6 addresses in host-resolver-rules
          const pinnedIp = urlValidation.resolvedIp.includes(':')
            ? `[${urlValidation.resolvedIp}]`
            : urlValidation.resolvedIp;
          browserArgs.push(`--host-resolver-rules=MAP ${urlValidation.hostname} ${pinnedIp}`);
        }
        const launched = await puppeteer.launch({
          headless: true,
          args: browserArgs,
          // SEC-006: Puppeteer disables Chromium's popup blocker by default. Keep it
          // on: a popup's navigation never passes through the page's request
          // interceptor (an unvalidated, SSRF-capable request), and popups can wedge
          // page.screenshot() indefinitely. Nothing here supplies a user gesture,
          // so the blocker stops every window.open() / target=_blank.
          ignoreDefaultArgs: ['--disable-popup-blocking'],
        });
        browser = launched;
        // The deadline may have fired while launch() was pending; finally{} has
        // already run, so this browser is ours to kill.
        if (timedOut) {
          await shutdownBrowser(launched, true);
          throw new Error('deadline exceeded during launch');
        }
        // SEC-006: Defense in depth — close any popup that slips past the blocker.
        launched.on('targetcreated', (target) => {
          if (target.opener()) {
            target.page().then(p => p?.close()).catch(() => { /* already gone */ });
          }
        });
        const page = await launched.newPage();
        if (width && height) await page.setViewport({ width, height });

        // SEC-001: Intercept requests to prevent SSRF via HTTP redirects.
        // page.goto() follows redirects by default; a 302 to an internal host
        // would bypass the initial URL validation and --host-resolver-rules pin.
        await page.setRequestInterception(true);
        page.on('request', async (req) => {
          try {
            // Only validate navigation requests (initial load + redirects).
            // Subresource requests (images, scripts, etc.) are allowed through
            // since blocking them would break most pages, and the primary SSRF
            // threat is navigation-level redirects to internal services.
            if (req.isNavigationRequest()) {
              const reqUrl = req.url();
              // Allow the original validated URL through without re-validation
              if (reqUrl === url) {
                req.continue();
                return;
              }
              // Validate redirect target against SSRF rules
              const redirectValidation = await validateUrl(reqUrl, { allowLocal: ALLOW_LOCAL });
              if (!redirectValidation.valid) {
                req.abort('blockedbyclient');
                return;
              }
              req.continue();
            } else {
              req.continue();
            }
          } catch {
            // If validation throws unexpectedly, abort the request rather than
            // leaving it dangling (which would hang page navigation until timeout).
            try { req.abort('failed'); } catch { /* request may already be handled */ }
          }
        });

        await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
        if (waitForSelector) await page.waitForSelector(waitForSelector, { timeout: 30000 });
        if (waitForTimeout) await new Promise(r => setTimeout(r, waitForTimeout));

        ensureDir(dest);

        if (selector) {
          const el = await page.$(selector);
          if (!el) { return err(`Element not found: ${selector}`); }
          await el.screenshot({ path: dest });
        } else {
          await page.screenshot({ path: dest, fullPage: fullPage || false });
        }
        return ok(`Screenshot saved: ${dest}`);
      };

      try {
        const work = capture();
        // Once the deadline wins, work's eventual rejection has no listener
        work.catch(() => { /* handled via the race below */ });
        // SEC-005: Overall deadline. Individual Puppeteer calls (notably
        // screenshot()) have no timeout of their own and can hang forever.
        const deadline = new Promise<never>((_, reject) => {
          deadlineTimer = setTimeout(() => {
            timedOut = true;
            reject(new Error(`timed out after ${SCREENSHOT_DEADLINE_MS}ms`));
          }, SCREENSHOT_DEADLINE_MS);
        });
        return await Promise.race([work, deadline]);
      } catch (e) {
        return err(`Screenshot error: ${e instanceof Error ? e.message : e}`);
      } finally {
        clearTimeout(deadlineTimer);
        // Ensure browser is always closed to prevent resource leaks
        // Close browser BEFORE releasing semaphore to avoid briefly exceeding concurrency limit.
        // On timeout, skip the graceful close (it would likely hang too) and kill outright.
        if (browser) {
          await shutdownBrowser(browser, timedOut);
        }
        // SEC-005: Always release permit to prevent deadlock, even on error
        puppeteerSemaphore.release();
      }
    }
  );
}
