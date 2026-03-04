// ============================================================================
// Windows screenshot provider — PowerShell + .NET System.Drawing
// ============================================================================

import type { ScreenshotProvider, CaptureOptions, WindowTarget, RegionTarget } from './screenshot-provider.js';
import { execFileAsync, commandExists, sleep } from './screenshot-provider.js';

/**
 * Windows screenshot provider using PowerShell with .NET System.Drawing.
 * Zero external dependencies — PowerShell and .NET are built into all modern Windows.
 */
export class WindowsProvider implements ScreenshotProvider {
  readonly platform = 'Windows';

  private static readonly DPI_AWARE_SNIPPET = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class DpiAwareness {
    [DllImport("user32.dll")]
    public static extern bool SetProcessDPIAware();
}
"@
[DpiAwareness]::SetProcessDPIAware() | Out-Null`.trim();

  async isAvailable(): Promise<boolean> {
    return commandExists('powershell');
  }

  async captureFullscreen(opts: CaptureOptions): Promise<void> {
    if (opts.delay && opts.delay > 0) await sleep(opts.delay);

    const format = this.dotNetFormat(opts.format);
    const displayIndex = (opts.display ?? 1) - 1; // Convert 1-based to 0-based

    const script = `
${WindowsProvider.DPI_AWARE_SNIPPET}
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$screens = [System.Windows.Forms.Screen]::AllScreens
$screen = if (${displayIndex} -lt $screens.Length) { $screens[${displayIndex}] } else { [System.Windows.Forms.Screen]::PrimaryScreen }
$bounds = $screen.Bounds
$bitmap = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
${opts.includeCursor ? '$cursorPos = [System.Windows.Forms.Cursor]::Position\n' : ''}
$graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
${opts.includeCursor ? this.cursorDrawScript() : ''}
$bitmap.Save('${this.escapePath(opts.outputPath)}', [System.Drawing.Imaging.ImageFormat]::${format})
$graphics.Dispose()
$bitmap.Dispose()
`.trim();

    await this.runPowerShell(script);
  }

  async captureWindow(opts: CaptureOptions & WindowTarget): Promise<void> {
    if (opts.delay && opts.delay > 0) await sleep(opts.delay);

    if (!opts.windowName && !opts.windowId) {
      throw new Error('Window mode requires windowName or windowId');
    }

    const format = this.dotNetFormat(opts.format);

    // Use windowName to find the process, or windowId as HWND
    const findWindowScript = opts.windowName
      ? `
$proc = Get-Process | Where-Object { $_.MainWindowTitle -like '*${this.escapeString(opts.windowName)}*' -and $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $proc) { throw "Window not found: ${this.escapeString(opts.windowName)}" }
$hwnd = $proc.MainWindowHandle
`
      : `$hwnd = [IntPtr]::new(${opts.windowId})`;

    const script = `
${WindowsProvider.DPI_AWARE_SNIPPET}
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32 {
    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT {
        public int Left, Top, Right, Bottom;
    }
}
"@
${findWindowScript}
[Win32]::SetForegroundWindow($hwnd) | Out-Null
Start-Sleep -Milliseconds 300
$rect = New-Object Win32+RECT
[Win32]::GetWindowRect($hwnd, [ref]$rect) | Out-Null
$width = $rect.Right - $rect.Left
$height = $rect.Bottom - $rect.Top
if ($width -le 0 -or $height -le 0) { throw "Invalid window dimensions" }
$bitmap = New-Object System.Drawing.Bitmap($width, $height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, (New-Object System.Drawing.Size($width, $height)))
$bitmap.Save('${this.escapePath(opts.outputPath)}', [System.Drawing.Imaging.ImageFormat]::${format})
$graphics.Dispose()
$bitmap.Dispose()
`.trim();

    await this.runPowerShell(script);
  }

  async captureRegion(opts: CaptureOptions & RegionTarget): Promise<void> {
    if (opts.delay && opts.delay > 0) await sleep(opts.delay);

    const format = this.dotNetFormat(opts.format);

    const script = `
${WindowsProvider.DPI_AWARE_SNIPPET}
Add-Type -AssemblyName System.Drawing
$bitmap = New-Object System.Drawing.Bitmap(${opts.width}, ${opts.height})
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen(${opts.x}, ${opts.y}, 0, 0, (New-Object System.Drawing.Size(${opts.width}, ${opts.height})))
$bitmap.Save('${this.escapePath(opts.outputPath)}', [System.Drawing.Imaging.ImageFormat]::${format})
$graphics.Dispose()
$bitmap.Dispose()
`.trim();

    await this.runPowerShell(script);
  }

  // ── Private helpers ────────────────────────────────────────────────────

  private async runPowerShell(script: string): Promise<void> {
    await execFileAsync('powershell', [
      '-ExecutionPolicy', 'Bypass',
      '-NoProfile',
      '-NonInteractive',
      '-Command', script,
    ]);
  }

  private dotNetFormat(format?: 'png' | 'jpg'): string {
    switch (format) {
      case 'jpg': return 'Jpeg';
      default: return 'Png';
    }
  }

  private escapePath(p: string): string {
    // Escape single quotes for PowerShell string literals
    return p.replace(/'/g, "''");
  }

  private escapeString(s: string): string {
    // Escape characters that could break PowerShell string interpolation
    return s.replace(/'/g, "''").replace(/[`$"]/g, '');
  }

  private cursorDrawScript(): string {
    return `
try {
  $cursorBounds = New-Object System.Drawing.Rectangle($cursorPos.X - $bounds.X, $cursorPos.Y - $bounds.Y, 32, 32)
  [System.Windows.Forms.Cursors]::Default.Draw($graphics, $cursorBounds)
} catch {}
`;
  }
}
