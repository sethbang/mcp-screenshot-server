// ============================================================================
// Linux screenshot provider — fallback chain of native tools
// ============================================================================

import type { ScreenshotProvider, CaptureOptions, WindowTarget, RegionTarget } from './screenshot-provider.js';
import { execFileAsync, commandExists, sleep } from './screenshot-provider.js';
import { detectLinuxDistro, getInstallCommand } from './linux-deps.js';

type LinuxBackend = 'gnome-screenshot' | 'spectacle' | 'scrot' | 'maim' | 'grim' | 'import';

/**
 * Linux screenshot provider with automatic tool detection.
 * Probes for available tools in priority order and uses the first one found.
 */
export class LinuxProvider implements ScreenshotProvider {
  readonly platform = 'Linux';

  private _backend: LinuxBackend | null = null;
  private _detected = false;

  async isAvailable(): Promise<boolean> {
    await this.detectBackend();
    return this._backend !== null;
  }

  async captureFullscreen(opts: CaptureOptions): Promise<void> {
    const backend = await this.getBackend();
    this.assertSupportedOptions(opts);
    if (opts.delay && opts.delay > 0) await sleep(opts.delay);

    switch (backend) {
      case 'gnome-screenshot':
        await execFileAsync('gnome-screenshot', ['-f', opts.outputPath]);
        break;

      case 'spectacle':
        await execFileAsync('spectacle', ['-b', '-n', '-f', '-o', opts.outputPath]);
        break;

      case 'scrot':
        await execFileAsync('scrot', [opts.outputPath]);
        break;

      case 'maim':
        await execFileAsync('maim', [opts.outputPath]);
        break;

      case 'grim':
        await execFileAsync('grim', [opts.outputPath]);
        break;

      case 'import':
        await execFileAsync('import', ['-window', 'root', opts.outputPath]);
        break;
    }
  }

  async captureWindow(opts: CaptureOptions & WindowTarget): Promise<void> {
    const backend = await this.getBackend();
    this.assertSupportedOptions(opts);

    // grim cannot capture per-window on Wayland — fail fast with the
    // backend-specific error before attempting xdotool resolution, which
    // would otherwise mask the real reason with a misleading message.
    if (backend === 'grim') {
      throw new Error('Window capture is not supported on Wayland with grim. Use fullscreen or region mode.');
    }

    if (opts.delay && opts.delay > 0) await sleep(opts.delay);

    // Try to resolve window ID from name using xdotool (X11 only)
    let xWindowId: string | undefined;
    if (opts.windowName && !opts.windowId) {
      xWindowId = await this.findXWindowId(opts.windowName);
    } else if (opts.windowId) {
      xWindowId = String(opts.windowId);
    }

    switch (backend) {
      case 'gnome-screenshot':
        // gnome-screenshot -w captures the focused window
        // If we have a window ID, try to focus it first via xdotool
        if (xWindowId) await this.focusWindow(xWindowId);
        await execFileAsync('gnome-screenshot', ['-w', '-f', opts.outputPath]);
        break;

      case 'spectacle':
        if (xWindowId) await this.focusWindow(xWindowId);
        await execFileAsync('spectacle', ['-b', '-n', '-a', '-o', opts.outputPath]);
        break;

      case 'scrot':
        if (xWindowId) await this.focusWindow(xWindowId);
        await execFileAsync('scrot', ['-u', opts.outputPath]);
        break;

      case 'maim':
        if (xWindowId) {
          await execFileAsync('maim', ['-i', xWindowId, opts.outputPath]);
        } else {
          // Fallback: capture focused window
          throw new Error('maim requires a window ID or xdotool for window-by-name capture');
        }
        break;

      case 'import':
        if (xWindowId) {
          await execFileAsync('import', ['-window', xWindowId, opts.outputPath]);
        } else {
          throw new Error('import requires a window ID for window capture');
        }
        break;
    }
  }

  async captureRegion(opts: CaptureOptions & RegionTarget): Promise<void> {
    const backend = await this.getBackend();
    this.assertSupportedOptions(opts);
    if (opts.delay && opts.delay > 0) await sleep(opts.delay);

    const geometry = `${opts.width}x${opts.height}+${opts.x}+${opts.y}`;

    switch (backend) {
      case 'gnome-screenshot':
        // gnome-screenshot doesn't support arbitrary region coordinates
        // Fall back to using maim/import if available, otherwise error
        throw new Error(
          'gnome-screenshot does not support region capture with coordinates. ' +
          'Install maim or scrot for region support.'
        );

      case 'spectacle':
        // spectacle --region requires interactive selection
        throw new Error(
          'spectacle does not support non-interactive region capture. ' +
          'Install maim or scrot for region support.'
        );

      case 'scrot':
        // scrot -a x,y,w,h
        await execFileAsync('scrot', ['-a', `${opts.x},${opts.y},${opts.width},${opts.height}`, opts.outputPath]);
        break;

      case 'maim':
        await execFileAsync('maim', ['-g', geometry, opts.outputPath]);
        break;

      case 'grim':
        await execFileAsync('grim', ['-g', `${opts.x},${opts.y} ${opts.width}x${opts.height}`, opts.outputPath]);
        break;

      case 'import':
        await execFileAsync('import', ['-crop', geometry, '-window', 'root', opts.outputPath]);
        break;
    }
  }

  // ── Private helpers ────────────────────────────────────────────────────

  private assertSupportedOptions(opts: CaptureOptions): void {
    if (opts.includeCursor) {
      throw new Error(
        'Linux provider does not support includeCursor — none of the supported backends ' +
        '(maim, scrot, gnome-screenshot, spectacle, grim, import) expose a cursor flag in our argv. ' +
        'Use macOS or Windows for cursor capture.'
      );
    }
  }

  private async detectBackend(): Promise<void> {
    if (this._detected) return;
    this._detected = true;

    // Priority order: most feature-complete first
    const candidates: LinuxBackend[] = [
      'maim', 'scrot', 'gnome-screenshot', 'spectacle', 'grim', 'import',
    ];

    for (const cmd of candidates) {
      if (await commandExists(cmd)) {
        this._backend = cmd;
        return;
      }
    }
  }

  private async getBackend(): Promise<LinuxBackend> {
    await this.detectBackend();
    if (!this._backend) {
      const distro = await detectLinuxDistro();
      const installCmd = getInstallCommand(distro.packageManager, ['maim', 'xdotool']);
      throw new Error(
        'No screenshot tool found on this Linux system. ' +
        'take_system_screenshot needs one of: maim, scrot, gnome-screenshot, spectacle, grim (Wayland), or ImageMagick (import). ' +
        `For a typical X11 install: ${installCmd}. ` +
        'See README for distro-specific instructions.'
      );
    }
    return this._backend;
  }

  /**
   * Find an X11 window ID by application name using xdotool. Throws a helpful
   * install hint when xdotool is missing — without it, no Linux backend can
   * honor a windowName request.
   */
  private async findXWindowId(name: string): Promise<string | undefined> {
    if (!(await commandExists('xdotool'))) {
      const distro = await detectLinuxDistro();
      const installCmd = getInstallCommand(distro.packageManager, ['xdotool']);
      throw new Error(
        'Window-by-name capture requires xdotool, which is not installed. ' +
        `Install it with: ${installCmd}. ` +
        'Alternatively, pass an explicit windowId.'
      );
    }
    try {
      const { stdout } = await execFileAsync('xdotool', ['search', '--name', name]);
      const ids = stdout.trim().split('\n').filter(Boolean);
      return ids[0]; // Return first match
    } catch {
      return undefined;
    }
  }

  /**
   * Focus a window by X11 window ID using xdotool.
   */
  private async focusWindow(windowId: string): Promise<void> {
    try {
      await execFileAsync('xdotool', ['windowactivate', '--sync', windowId]);
      // Brief pause to let the window manager bring it to front
      await sleep(0.3);
    } catch {
      // Non-fatal — window may still be capturable
    }
  }
}
