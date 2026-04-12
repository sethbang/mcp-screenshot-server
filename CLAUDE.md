# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

An MCP (Model Context Protocol) server that provides two screenshot tools to AI assistants:
- **`take_screenshot`** — web page capture via headless Puppeteer/Chromium
- **`take_system_screenshot`** — cross-platform system screenshots using native OS tools (macOS `screencapture`, Linux `maim`/`scrot`/etc., Windows PowerShell+.NET)

Published to npm as `universal-screenshot-mcp`.

## Commands

```bash
npm run build          # TypeScript → build/ (also runs on npm install via "prepare")
npm run watch          # Recompile on change
npm test               # Run all tests (vitest run)
npm run test:watch     # Watch mode
npm run test:coverage  # With coverage
npm run lint           # ESLint on src/
npm run inspector      # Launch MCP Inspector for interactive tool debugging
```

Run a single test file: `npx vitest run tests/validators/url.test.ts`

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

Tests live in `tests/` mirroring `src/` structure. Uses Vitest with full dependency injection — **no real network, filesystem, or subprocess calls**. Shared mocks are in `tests/mocks/` (dns, fs, child-process). When adding tests, follow the existing DI pattern rather than mocking modules globally.
