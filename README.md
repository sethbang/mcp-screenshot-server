# Universal Screenshot MCP

[![npm version](https://img.shields.io/npm/v/universal-screenshot-mcp.svg)](https://www.npmjs.com/package/universal-screenshot-mcp)
[![MCP Registry](https://img.shields.io/badge/MCP_Registry-io.github.sethbang%2Fscreenshot--server-blue)](https://registry.modelcontextprotocol.io)
[![License](https://img.shields.io/badge/license-Apache--2.0-green.svg)](LICENSE)

An [MCP (Model Context Protocol)](https://modelcontextprotocol.io/) server that provides AI assistants with screenshot capabilities — both web page capture via [Puppeteer](https://pptr.dev/) and cross-platform system screenshots using native OS tools.

## Features

- **Web Page Screenshots** — Capture any public URL using a headless Chromium browser
- **Cross-Platform System Screenshots** — Fullscreen, window, or region capture using native OS tools (macOS `screencapture`, Linux `maim`/`scrot`/`gnome-screenshot`/etc., Windows PowerShell+.NET)
- **Security-First Design** — SSRF prevention, path traversal protection, DNS rebinding defense, command injection prevention, and DoS limiting
- **MCP Native** — Integrates directly with Claude Desktop, Cursor, and any MCP-compatible client

## Requirements

- **Node.js** >= 18.0.0
- **Chromium** is downloaded automatically by Puppeteer on first run

### Platform-Specific Requirements for `take_system_screenshot`

| Platform | Required Tools | Notes |
|----------|---------------|-------|
| **macOS** | `screencapture` (built-in) | No additional installation needed |
| **Linux** | One of: `maim`, `scrot`, `gnome-screenshot`, `spectacle`, `grim`, or `import` (ImageMagick) | `maim` or `scrot` recommended for full feature support. For window-by-name capture, also install `xdotool`. |
| **Windows** | `powershell` (built-in) | Uses .NET `System.Drawing` — no additional installation needed |

#### Linux Installation Examples

```bash
# Ubuntu/Debian (recommended)
sudo apt install maim xdotool

# Fedora
sudo dnf install maim xdotool

# Arch Linux
sudo pacman -S maim xdotool

# Wayland (Sway, etc.)
sudo apt install grim
```

## Quick Start

### Install from npm

```bash
npm install -g universal-screenshot-mcp
```

Or run directly with `npx`:

```bash
npx universal-screenshot-mcp
```

### Install from Source

```bash
git clone https://github.com/sethbang/mcp-screenshot-server.git
cd mcp-screenshot-server
npm install
npm run build
```

### Configure Your MCP Client

Add the server to your MCP client configuration. For **Claude Desktop**, edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "screenshot-server": {
      "command": "npx",
      "args": ["-y", "universal-screenshot-mcp"]
    }
  }
}
```

Or if installed from source:

```json
{
  "mcpServers": {
    "screenshot-server": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-screenshot-server/build/index.js"]
    }
  }
}
```

For **Cursor** or other MCP clients, consult their documentation for the equivalent configuration.

## Tools

The server exposes two MCP tools:

### `take_screenshot`

Captures a web page (or a specific element) via a headless Puppeteer browser.

| Parameter         | Type    | Required | Description                                      |
|-------------------|---------|----------|--------------------------------------------------|
| `url`             | string  | ✅       | URL to capture (http/https only)                 |
| `width`           | number  | —        | Viewport width (1–3840)                          |
| `height`          | number  | —        | Viewport height (1–2160)                         |
| `fullPage`        | boolean | —        | Capture the full scrollable page                 |
| `selector`        | string  | —        | CSS selector to capture a specific element        |
| `waitForSelector` | string  | —        | Wait for this selector before capturing          |
| `waitForTimeout`  | number  | —        | Delay in milliseconds (0–30000)                  |
| `outputPath`      | string  | —        | Output file path (default: `~/Documents/screenshots`) |

**Example prompt:**
> Take a screenshot of https://example.com at 1920x1080

### `take_system_screenshot`

Captures the desktop, a specific application window, or a screen region using native OS tools. Works on **macOS**, **Linux**, and **Windows**.

| Parameter       | Type    | Required | Description                                              |
|-----------------|---------|----------|----------------------------------------------------------|
| `mode`          | enum    | ✅       | `fullscreen`, `window`, or `region`                      |
| `windowId`      | number  | —        | Window ID for window mode                                |
| `windowName`    | string  | —        | App name (e.g. `"Safari"`, `"Firefox"`) for window mode  |
| `region`        | object  | —        | `{ x, y, width, height }` for region mode                |
| `display`       | number  | —        | Display number for multi-monitor setups                  |
| `includeCursor` | boolean | —        | Include the mouse cursor in the capture                  |
| `format`        | enum    | —        | `png` (default) or `jpg`                                 |
| `delay`         | number  | —        | Capture delay in seconds (0–10)                          |
| `outputPath`    | string  | —        | Output file path (default: `~/Documents/screenshots`)    |

#### Cross-Platform Feature Support

| Feature | macOS | Linux | Windows |
|---------|-------|-------|---------|
| Fullscreen | ✅ | ✅ | ✅ |
| Region | ✅ | ✅ (maim, scrot, grim, import) | ✅ |
| Window by name | ✅ | ⚠️ X11 + xdotool | ⚠️ best-effort |
| Window by ID | ✅ | ✅ X11 only | ⚠️ HWND |
| Multi-display | ✅ | ⚠️ tool-dependent | ✅ |
| Include cursor | ✅ | ⚠️ tool-dependent | ⚠️ |
| Delay | ✅ | ✅ | ✅ |

**Example prompt:**
> Take a system screenshot of the Safari window

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SCREENSHOT_OUTPUT_DIR` | `Documents/screenshots` | Default output directory relative to `~` |
| `ALLOW_LOCAL` | `false` | Set to `true` to allow screenshotting `localhost`/`127.x.x.x`/`[::1]` (useful for local dev servers) |

### Output Directories

Screenshots are saved to `~/Documents/screenshots` by default (configurable via `SCREENSHOT_OUTPUT_DIR`). Custom output paths must resolve to one of these allowed directories:

| Directory              | Description              |
|------------------------|--------------------------|
| `~/Documents/screenshots` | Default output location (configurable) |
| `~/Desktop/Screenshots`| Original default location |
| `~/Downloads`          | User downloads folder    |
| `~/Documents`          | User documents folder    |
| `/tmp`                 | System temp directory    |

## Security

This server implements multiple layers of security hardening:

| ID      | Threat                | Mitigation                                                                                  |
|---------|-----------------------|---------------------------------------------------------------------------------------------|
| SEC-001 | SSRF / DNS rebinding  | URLs validated against blocked IP ranges; DNS resolved pre-request with IP pinning via `--host-resolver-rules`; navigation redirects re-validated |
| SEC-003 | Command injection     | All subprocesses use `execFile` (no shell); app names validated against `SAFE_APP_NAME_PATTERN` |
| SEC-004 | Path traversal        | Output paths validated with `fs.realpath()` symlink resolution; restricted to allowed directories |
| SEC-005 | Denial of service     | Concurrent Puppeteer instances limited to 3 via semaphore                                   |

For full details, see [`docs/security.md`](docs/security.md).

## Development

### Scripts

| Command              | Description                            |
|----------------------|----------------------------------------|
| `npm run build`      | Compile TypeScript to `build/`         |
| `npm run watch`      | Recompile on file changes              |
| `npm test`           | Unit tests (fast, fully mocked)        |
| `npm run test:integration` | Integration tests (real DNS/filesystem) |
| `npm run test:e2e`   | E2E tests (real Puppeteer/native tools)|
| `npm run test:all`   | All test tiers together                |
| `npm run test:linux` | Linux e2e via Docker (requires Docker) |
| `npm run test:watch` | Run tests in watch mode                |
| `npm run test:coverage` | Run tests with coverage report      |
| `npm run lint`       | Lint source with ESLint                |
| `npm run inspector`  | Launch MCP Inspector for debugging     |

### Project Structure

```
src/
├── index.ts                 # Entry point — stdio transport
├── server.ts                # MCP server factory
├── config/
│   ├── index.ts             # Static constants (limits, allowed dirs)
│   └── runtime.ts           # Singleton semaphore, default directory
├── tools/
│   ├── take-screenshot.ts   # Web page capture tool
│   └── take-system-screenshot.ts  # macOS system capture tool
├── types/
│   └── index.ts             # Shared TypeScript interfaces
├── utils/
│   ├── helpers.ts           # Response builders, file utilities
│   ├── screenshot-provider.ts # Cross-platform provider interface + factory
│   ├── macos-provider.ts    # macOS: screencapture wrapper
│   ├── linux-provider.ts    # Linux: maim/scrot/gnome-screenshot/etc.
│   ├── windows-provider.ts  # Windows: PowerShell + .NET System.Drawing
│   ├── macos.ts             # Window ID lookup via CoreGraphics
│   └── semaphore.ts         # Async concurrency limiter
└── validators/
    ├── path.ts              # Output path validation (SEC-004)
    └── url.ts               # URL/SSRF validation (SEC-001)
```

### Testing

Tests use [Vitest](https://vitest.dev/) in three tiers:

- **Unit** (`npm test`) — Full dependency injection, no real I/O. Fast feedback loop.
- **Integration** (`npm run test:integration`) — Real DNS resolution, real filesystem with temp directories, real Puppeteer against a local HTTP server.
- **E2E** (`npm run test:e2e`) — Real native screenshot tools. macOS tests run natively; Linux tests run in Docker via `npm run test:linux`.

```bash
npm test                 # Unit tests (~300ms)
npm run test:linux       # Linux provider tests in Docker
npm run test:all         # Everything
```

### Debugging with MCP Inspector

```bash
npm run inspector
```

This launches the [MCP Inspector](https://modelcontextprotocol.io/docs/tools/inspector) connected to your built server, allowing you to invoke tools interactively.

## License

[Apache-2.0](LICENSE) — Copyright 2026 Seth Bang
