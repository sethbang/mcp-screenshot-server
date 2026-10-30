# Architecture

This document describes the internal architecture of the MCP Screenshot Server.

## Overview

The server implements the [Model Context Protocol](https://modelcontextprotocol.io/) over standard I/O (stdin/stdout). It exposes two tools to MCP clients and handles screenshot capture through two distinct backends: Puppeteer (web) and cross-platform native OS tools (system).

```
┌─────────────────┐     stdio      ┌──────────────────────────────────┐
│   MCP Client    │◄──────────────►│       MCP Screenshot Server      │
│ (Claude, etc.)  │                │                                  │
└─────────────────┘                │  ┌────────────────────────────┐  │
                                   │  │     take_screenshot        │  │
                                   │  │  URL → Puppeteer → PNG     │  │
                                   │  └────────────────────────────┘  │
                                   │  ┌────────────────────────────┐  │
                                   │  │  take_system_screenshot    │  │
                                   │  │  Mode → OS Provider → PNG  │  │
                                   │  └────────────────────────────┘  │
                                   └──────────────────────────────────┘
```

## Module Layers

The codebase is organized into four layers with strict dependency direction (top depends on bottom):

### 1. Entry Point

[`src/index.ts`](../src/index.ts) — Creates the server and connects it to a `StdioServerTransport`. This is the only file with side effects (process I/O). Excluded from test coverage.

### 2. Server Factory

[`src/server.ts`](../src/server.ts) — The [`createServer()`](../src/server.ts:9) function instantiates an `McpServer` and registers both tools. Returns the server instance without connecting it, enabling testability.

### 3. Tools

Each tool is a self-contained registration function that receives an `McpServer` and calls `server.registerTool()`:

- [`registerTakeScreenshot()`](../src/tools/take-screenshot.ts:12) — Web page capture via Puppeteer
- [`registerTakeSystemScreenshot()`](../src/tools/take-system-screenshot.ts:12) — Cross-platform system capture via OS-native tools

Both tools follow the same pattern:
1. Ensure default output directory exists
2. Validate inputs (URL, output path)
3. Perform capture
4. Return an [`McpToolResponse`](../src/types/index.ts:17)

### 4. Shared Infrastructure

| Module | Purpose |
|--------|---------|
| [`src/config/index.ts`](../src/config/index.ts) | Static constants — concurrency limits, allowed directories, safe patterns |
| [`src/config/runtime.ts`](../src/config/runtime.ts) | Singleton runtime state — semaphore instance, default directory creation |
| [`src/validators/url.ts`](../src/validators/url.ts) | URL validation with SSRF/DNS rebinding protection |
| [`src/validators/path.ts`](../src/validators/path.ts) | Output path validation with symlink resolution |
| [`src/utils/helpers.ts`](../src/utils/helpers.ts) | Response builders (`ok`, `err`), timestamp generation, directory creation |
| [`src/utils/screenshot-provider.ts`](../src/utils/screenshot-provider.ts) | Cross-platform `ScreenshotProvider` interface, factory, shared utilities |
| [`src/utils/macos-provider.ts`](../src/utils/macos-provider.ts) | macOS provider — wraps `screencapture` CLI |
| [`src/utils/linux-provider.ts`](../src/utils/linux-provider.ts) | Linux provider — auto-detects maim/scrot/gnome-screenshot/spectacle/grim/import |
| [`src/utils/windows-provider.ts`](../src/utils/windows-provider.ts) | Windows provider — PowerShell + .NET System.Drawing |
| [`src/utils/macos.ts`](../src/utils/macos.ts) | Window ID lookup via CoreGraphics/Swift (macOS-specific) |
| [`src/utils/semaphore.ts`](../src/utils/semaphore.ts) | Generic async semaphore implementation |
| [`src/types/index.ts`](../src/types/index.ts) | Shared TypeScript interfaces |

## Key Design Decisions

### Singleton Semaphore

The Puppeteer concurrency semaphore is instantiated exactly once in [`src/config/runtime.ts`](../src/config/runtime.ts) and imported by tools. An ESLint rule in [`eslint.config.js`](../eslint.config.js) prevents direct `new Semaphore()` calls outside the designated files, enforcing the singleton pattern at the lint level.

### Dependency Injection

All external dependencies (DNS resolver, filesystem, command executor) are injectable via optional parameters with production defaults:

- [`validateUrl()`](../src/validators/url.ts:131) accepts a `DnsResolver`
- [`validateOutputPath()`](../src/validators/path.ts:24) accepts a `FileSystem`
- [`getWindowId()`](../src/utils/macos.ts:30) accepts a `CommandExecutor`

This enables pure unit tests with no real I/O.

### Lazy Directory Creation

The default output directory (`~/Desktop/Screenshots`) is created on first tool invocation via [`ensureDefaultDirectory()`](../src/config/runtime.ts:15), not at import time. This avoids side effects during module loading and testing.

### Non-Blocking Semaphore

The `take_screenshot` tool uses [`tryAcquire()`](../src/utils/semaphore.ts:35) instead of the blocking [`acquire()`](../src/utils/semaphore.ts:21). When all permits are taken, the request is immediately rejected with an error message rather than queued. This prevents memory exhaustion from queued requests each holding reference to expensive Puppeteer state.

## Request Lifecycle

### `take_screenshot` Flow

```
1. ensureDefaultDirectory()
2. validateUrl(url)           → SSRF check + DNS resolution
3. validateOutputPath(path)   → Path traversal check + symlink resolution
4. puppeteerSemaphore.tryAcquire()  → DoS protection
5. puppeteer.launch({ args: [--host-resolver-rules=...] })
6. page.setRequestInterception(true)  → Redirect validation
7. page.goto(url)
8. page.screenshot({ path: dest })
9. browser.close()
10. puppeteerSemaphore.release()
```

### `take_system_screenshot` Flow

```
1. ensureDefaultDirectory()
2. getScreenshotProvider()    → Detect OS, probe for available tools, cache provider
3. validateOutputPath(path)   → Path traversal check + symlink resolution
4. Delegate to provider based on mode:
   - fullscreen → provider.captureFullscreen()
   - window    → provider.captureWindow()  (resolves window name/ID per platform)
   - region    → provider.captureRegion()
5. Verify output file exists
```

#### Platform Provider Dispatch

| Platform | Provider | Backend |
|----------|----------|---------|
| macOS | `MacOSProvider` | `screencapture` CLI + CoreGraphics (Swift) for window lookup |
| Linux | `LinuxProvider` | Auto-detected: maim → scrot → gnome-screenshot → spectacle → grim → import |
| Windows | `WindowsProvider` | PowerShell + .NET `System.Drawing` + `user32.dll` P/Invoke |

## Testing Strategy

Tests are located in `tests/` mirroring the `src/` structure. All tests use dependency injection to avoid real I/O:

| Test File | What It Tests |
|-----------|---------------|
| [`tests/validators/url.test.ts`](../tests/validators/url.test.ts) | URL validation, IP blocking, DNS rebinding |
| [`tests/validators/path.test.ts`](../tests/validators/path.test.ts) | Path validation, symlink resolution |
| [`tests/utils/helpers.test.ts`](../tests/utils/helpers.test.ts) | Response builders, timestamp format |
| [`tests/utils/macos.test.ts`](../tests/utils/macos.test.ts) | Window ID lookup with mock executor |
| [`tests/utils/semaphore.test.ts`](../tests/utils/semaphore.test.ts) | Semaphore acquire/release/tryAcquire |
| [`tests/tools/take-screenshot.test.ts`](../tests/tools/take-screenshot.test.ts) | Web screenshot tool integration |
| [`tests/tools/take-system-screenshot.test.ts`](../tests/tools/take-system-screenshot.test.ts) | System screenshot tool integration (provider-based) |
| [`tests/utils/screenshot-provider.test.ts`](../tests/utils/screenshot-provider.test.ts) | Provider factory and shared utilities |
| [`tests/utils/macos-provider.test.ts`](../tests/utils/macos-provider.test.ts) | macOS provider — screencapture args, window lookup |
| [`tests/utils/linux-provider.test.ts`](../tests/utils/linux-provider.test.ts) | Linux provider — tool detection, all backends |
| [`tests/utils/windows-provider.test.ts`](../tests/utils/windows-provider.test.ts) | Windows provider — PowerShell scripts, injection prevention |
| [`tests/architecture/singleton.test.ts`](../tests/architecture/singleton.test.ts) | Singleton semaphore enforcement |

Coverage thresholds are configured in [`vitest.config.ts`](../vitest.config.ts): 50% lines, 40% branches, 50% functions, 50% statements.
