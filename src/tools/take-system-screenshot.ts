import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { existsSync } from 'fs';
import { defaultOutDir, ensureDefaultDirectory } from '../config/runtime.js';
import { ALLOWED_OUTPUT_DIRS } from '../config/index.js';
import { validateOutputPath } from '../validators/path.js';
import { ok, err, timestamp, ensureDir } from '../utils/helpers.js';
import { getScreenshotProvider } from '../utils/screenshot-provider.js';

// No semaphore — system screenshot tools are lightweight (< 100ms, < 10MB)

export function registerTakeSystemScreenshot(server: McpServer): void {
  server.registerTool(
    'take_system_screenshot',
    {
      description:
        'Capture desktop, window, or region screenshot. Cross-platform: macOS (screencapture), Linux (maim/scrot/gnome-screenshot/etc.), Windows (PowerShell+.NET). Saves to ~/Documents/screenshots by default (configurable via SCREENSHOT_OUTPUT_DIR env var). For window mode, provide windowName (app name like "Safari") or windowId.',
      inputSchema: {
        mode: z
          .enum(['fullscreen', 'window', 'region'])
          .describe(
            'fullscreen=entire screen, window=specific app (requires windowName or windowId), region=coordinates'
          ),
        windowId: z.number().int().min(0).optional().describe('Window ID (for window mode)'),
        windowName: z
          .string()
          .optional()
          .describe('App name like "Safari", "Firefox" (for window mode)'),
        region: z
          .object({
            x: z.number().int().min(0),
            y: z.number().int().min(0),
            width: z.number().int().min(1).max(7680),
            height: z.number().int().min(1).max(4320),
          })
          .optional()
          .describe('Region {x,y,width,height}'),
        display: z.number().int().min(1).optional().describe('Display number'),
        includeCursor: z.boolean().optional().describe('Include cursor'),
        format: z.enum(['png', 'jpg']).optional().describe('Image format (png or jpg)'),
        delay: z.number().min(0).max(10).optional().describe('Delay seconds'),
        outputPath: z
          .string()
          .optional()
          .describe('Absolute path, or relative to home dir'),
      },
    },
    async ({
      mode,
      windowId,
      windowName,
      region,
      display,
      includeCursor,
      format,
      delay,
      outputPath: custom,
    }) => {
      ensureDefaultDirectory();

      try {
        // Get the platform-appropriate screenshot provider
        const provider = await getScreenshotProvider();

        const ext = format || 'png';

        // Security: Validate output path (path traversal prevention)
        const pathValidation = await validateOutputPath(
          custom,
          `system-screenshot-${timestamp()}.${ext}`,
          { allowedOutputDirs: ALLOWED_OUTPUT_DIRS, defaultOutDir }
        );
        if (!pathValidation.valid) {
          return err(`Output path validation failed: ${pathValidation.error}`);
        }
        const dest = pathValidation.path!;
        ensureDir(dest);

        const captureOpts = {
          outputPath: dest,
          format: format as 'png' | 'jpg' | undefined,
          includeCursor,
          delay,
          display,
        };

        if (mode === 'fullscreen') {
          await provider.captureFullscreen(captureOpts);
        } else if (mode === 'window') {
          await provider.captureWindow({ ...captureOpts, windowId, windowName });
        } else if (mode === 'region') {
          if (!region) return err('Region mode requires region coordinates');
          await provider.captureRegion({ ...captureOpts, ...region });
        }

        if (!existsSync(dest)) return err('Screenshot failed — file not created');
        return ok(`System screenshot saved: ${dest}`);
      } catch (e) {
        return err(
          `System screenshot error: ${e instanceof Error ? e.message : e}`
        );
      }
    }
  );
}
