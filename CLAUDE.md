# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

An MCP (Model Context Protocol) server that provides two screenshot tools to AI assistants:
- **`take_screenshot`** — web page capture via headless Puppeteer/Chromium
- **`take_system_screenshot`** — cross-platform system screenshots using native OS tools (macOS `screencapture`, Linux `maim`/`scrot`/etc., Windows PowerShell+.NET)

Published to npm as `universal-screenshot-mcp`.

## Commands

```bash
npm run build            # TypeScript → build/ (also runs on npm install via "prepare")
npm run watch            # Recompile on change
npm test                 # Unit tests only (fast, fully mocked)
npm run test:integration # Integration tests (real DNS, real filesystem)
npm run test:e2e         # E2E tests (real Puppeteer, real screencapture)
npm run test:all         # All tiers together
npm run test:linux       # Linux e2e via Docker (Xvfb + maim/scrot/import)
npm run test:watch       # Watch mode
npm run test:coverage    # With coverage
npm run lint             # ESLint on src/
npm run inspector        # Launch MCP Inspector for interactive tool debugging
```

Run a single test file: `npx vitest run tests/validators/url.test.ts`

## Environment Variables

- **`ALLOW_LOCAL=true`** — Permit loopback addresses (127.x.x.x, ::1, localhost) through SSRF validation. Useful for screenshotting local dev servers. Off by default.
- **`SCREENSHOT_OUTPUT_DIR`** — Override the default screenshot output directory (relative to `~`). Defaults to `~/Documents/screenshots`.

## Architecture

**ESM-only** (`"type": "module"`), TypeScript strict mode, target ES2022, Node16 module resolution. Output goes to `build/`.

### Entry flow
`src/index.ts` → creates server via `src/server.ts` → connects stdio transport. `server.ts` registers both tools on an `McpServer` instance.

### Tool registration pattern
Each tool in `src/tools/` exports a `register*` function that takes an `McpServer` and calls `server.tool()` with Zod schemas for input validation. Tools are self-contained modules.

### System screenshot provider pattern
`src/utils/screenshot-provider.ts` defines a `ScreenshotProvider` interface and a factory that returns the platform-specific implementation:
- `macos-provider.ts` — wraps `screencapture` CLI
- `linux-provider.ts` — detects and wraps `maim`/`scrot`/`gnome-screenshot`/`spectacle`/`grim`/`import`
- `windows-provider.ts` — generates and runs PowerShell scripts using .NET `System.Drawing`

All providers use `execFile` (no shell) to prevent command injection (SEC-003).

### Security validators (`src/validators/`)
- `url.ts` — SSRF prevention: blocks private IPs, resolves DNS pre-request, pins IPs via `--host-resolver-rules`
- `path.ts` — path traversal prevention: resolves symlinks via `fs.realpath()`, restricts to allowed dirs in `src/config/index.ts`

### Concurrency control
`src/utils/semaphore.ts` limits concurrent Puppeteer instances to 3 (configurable in `src/config/index.ts`). Runtime singleton in `src/config/runtime.ts`.

## Testing

Three-tier test architecture with separate vitest configs:

| Tier | Pattern | What's real | Command |
|------|---------|-------------|---------|
| Unit | `*.test.ts` | Nothing — full DI mocks | `npm test` |
| Integration | `*.integration.test.ts` | DNS, filesystem, Puppeteer | `npm run test:integration` |
| E2E | `*.e2e.test.ts` | Everything incl. native tools | `npm run test:e2e` |

Tests live in `tests/` mirroring `src/` structure. Shared mocks are in `tests/mocks/` (dns, fs, child-process). Test helpers (`tests/helpers/`) provide a temp directory factory and a local HTTP test server.

Unit tests use full dependency injection — **no real network, filesystem, or subprocess calls**. When adding unit tests, follow the existing DI pattern rather than mocking modules globally.

### Docker-based Linux testing

`npm run test:linux` builds a Docker image (`Dockerfile.linux-test`) with Xvfb, maim, scrot, ImageMagick, and xdotool, then runs the e2e suite inside it. This is the only way to test the Linux screenshot provider locally on macOS.
