# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.2.0] - 2026-05-01

### Added

- **`--doctor` subcommand** (`npx universal-screenshot-mcp --doctor`) probes the host and reports per-platform check results with copy-pasteable install commands for any missing tools. Exits non-zero on failures so it can gate CI/scripting. Linux distros recognized via `/etc/os-release`: Debian/Ubuntu/Pop/Mint/Kali (apt), Fedora/RHEL/CentOS/Rocky/Alma (dnf), Arch/Manjaro/EndeavourOS (pacman), openSUSE/SLES (zypper), Alpine (apk).
- **Linux startup stderr warning.** When the server starts on Linux and no screenshot backend is detected, prints a one-line warning pointing users at `--doctor` so the missing-dependency surprise surfaces at boot instead of at first tool call. Fire-and-forget so it doesn't add boot latency.
- README: Claude Code install subsection (`claude mcp add`) mirroring the existing Claude Desktop pattern, plus a `--doctor` verification line at the end of the Linux Installation Examples.
- CI matrix: unit tests now run on `ubuntu-latest`, `macos-latest`, and `windows-latest` (was Linux only). New separate `lint` job runs `eslint src/` on every push and PR.
- Cross-platform test fixtures (`os.tmpdir()`/`os.homedir()`) so the test suite runs on Windows. Plus a Node-contract test in `tests/validators/path.test.ts` that locks the `path.win32.isAbsolute` semantics the v1.1.2 cross-drive Windows fix depends on.
- Vitest coverage thresholds tightened from 50/40/50/50 to 73/68/73/74 (statements/branches/functions/lines), set ~2pp below current measured coverage so meaningful regressions surface in CI.

### Changed

- **Linux runtime errors now include distro-specific install commands** inferred from `/etc/os-release`. The "no screenshot tool found" error from `LinuxProvider` ends with e.g. `For a typical X11 install: sudo apt install maim xdotool` (or `sudo pacman -S maim xdotool` on Arch, `sudo apk add maim xdotool` on Alpine, etc.) instead of a generic tool list. Same treatment for the missing-`xdotool` path when calling `take_system_screenshot` with `windowName`.
- **BREAKING:** `engines.node` floor raised from `>=18.0.0` to `^20.19.0 || ^22.13.0 || >=24` to match ESLint 10's runtime requirement. Users on Node 18 or early Node 20 (<20.19) can no longer install.
- Bumped dev tooling: TypeScript 5.7 → 6.0, ESLint 9 → 10, `@typescript-eslint/*` 8.54 → 8.59. New devDep `jiti` (ESLint 10 needs it to load TS config files).

## [1.1.2] - 2026-04-22

### Changed

- Tool descriptions for `take_screenshot` and `take_system_screenshot` now correctly advertise `~/Documents/screenshots` as the default output directory and mention the `SCREENSHOT_OUTPUT_DIR` env var (had been stale since v1.1.0).
- Path validation error message no longer hardcodes `/tmp`; says "system temp directory" so it's accurate on Windows.
- Linux provider now throws a clear error when `includeCursor: true` is requested, instead of silently dropping the option. None of the supported Linux backends (maim, scrot, gnome-screenshot, spectacle, grim, import) exposes a cursor flag in our argv shape. `format` continues to work via the output-path extension.

### Fixed

- **Windows: DPI awareness and multi-monitor virtual screen capture.** Previously screenshots on high-DPI Windows displays could be cropped, scaled incorrectly, or miss secondary monitors. *(PR #8 from @Supremesir)*
- **Windows: Fall back to absolute PowerShell path** (`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`) when `powershell` is not on `PATH`. Fixes the "No screenshot tools found for Windows" error when the server runs as a subprocess via the Agent Client Protocol with a minimal inherited `PATH`. *(PR #8 from @Supremesir)*
- **Windows: Cross-platform home directory resolution** — replaced `process.env.HOME || '/tmp'` with `os.homedir()` so screenshots no longer get written to `C:\tmp\Documents\screenshots` on Windows. *(PR #8 from @Supremesir)*
- **Windows: Unicode (CJK) window names** — switched the PowerShell invocation from `-Command` to `-EncodedCommand` (base64 UTF-16LE) so non-ASCII window names like `微信` survive the ANSI codepage on non-English Windows. *(PR #8 from @Supremesir)*
- **Path validator (Windows): cross-drive containment bypass.** Containment check used `relativePath.startsWith('/')` to detect when `path.relative()` returned an absolute path. On Windows that path looks like `D:\other\foo`, which doesn't start with `/`, allowing cross-drive paths to incorrectly pass validation. Replaced with `path.isAbsolute()`.
- **`display` parameter validation.** Zod schema for `take_system_screenshot` accepted non-integer values (`z.number().min(1)`), which would interpolate floats into the PowerShell `$screens[${i}]` template on Windows. Now `z.number().int().min(1)`.

## [1.1.1] - 2026-04-12

### Fixed

- CI: Added `--provenance` flag for npm OIDC trusted publishing so `npm publish` succeeds under the GitHub Actions OIDC publish flow.

## [1.1.0] - 2026-04-12

### Added

- **`SCREENSHOT_OUTPUT_DIR` environment variable** to configure the default screenshot output directory (relative to home). Defaults to `~/Documents/screenshots`. *(#6 from @prismaymedia)*
- **`ALLOW_LOCAL` environment variable** to permit loopback addresses (127.x.x.x, ::1, localhost) through SSRF validation, useful for screenshotting local dev servers. Off by default.
- **Three-tier test architecture** with separate vitest configs for unit (`*.test.ts`), integration (`*.integration.test.ts`), and e2e (`*.e2e.test.ts`) tiers. New scripts: `test:integration`, `test:e2e`, `test:all`, `test:linux`, `test:coverage`.
- **Docker-based Linux e2e testing** (`Dockerfile.linux-test`) with Xvfb, maim, scrot, ImageMagick, and xdotool — the only way to test the Linux provider locally on macOS. Runs in CI as a separate job.
- **CI workflow** (`.github/workflows/ci.yml`) running unit, integration, and Linux e2e tiers on every push and pull request.
- DPI-awareness assertions for all Windows capture methods.
- `CLAUDE.md` with project guidance for AI coding assistants.

### Changed

- **Default screenshot output directory** changed from `~/Desktop/Screenshots` to `~/Documents/screenshots`. The original `~/Desktop/Screenshots` remains in `ALLOWED_OUTPUT_DIRS` so existing scripts that wrote there still work.
- README and CLAUDE.md updated for new test tiers, env vars, and security model.
- GitHub Actions upgraded to v5 for Node.js 24 compatibility.

### Fixed

- **Windows high-DPI displays:** Resolved an issue (#5) where screenshots were captured at the wrong resolution on high-DPI Windows displays.
- **IPv6 host-resolver-rules:** Wrapped IPv6 addresses in brackets so Chromium's `--host-resolver-rules` parses them correctly.

## [1.0.0] - 2026-02-07

### Added

- MCP Screenshot Server implementing Model Context Protocol for screenshot capture
- Published to npm as `universal-screenshot-mcp` and to the MCP Registry as `io.github.sethbang/screenshot-server`
- `take_screenshot` tool for web page capture via headless Puppeteer browser
  - Full-page capture mode
  - CSS selector-based element capture
  - Configurable viewport dimensions (up to 3840x2160)
  - Wait for selector/timeout options for dynamic content
  - Customizable output path with default to `~/Desktop/Screenshots`
- `take_system_screenshot` tool for cross-platform system screenshots via native OS tools
  - Fullscreen capture mode
  - Window capture by app name or window ID
  - Region capture with coordinate specification
  - Multi-display support
  - PNG and JPG output formats
  - Optional cursor inclusion and capture delay
- `ScreenshotProvider` interface and factory in `src/utils/screenshot-provider.ts`
- **macOS**: `screencapture` CLI wrapper (`MacOSProvider`)
- **Linux**: Auto-detects available tool (maim → scrot → gnome-screenshot → spectacle → grim → import) (`LinuxProvider`). Window-by-name uses `xdotool` on X11.
- **Windows**: PowerShell + .NET `System.Drawing` — zero external dependencies (`WindowsProvider`)
- Provider-specific unit tests: `macos-provider.test.ts`, `linux-provider.test.ts`, `windows-provider.test.ts`, `screenshot-provider.test.ts`
- GitHub Actions workflow for automated npm + MCP Registry publishing on tag push

### Security

- **SEC-001**: DNS rebinding protection - URL validation resolves DNS before allowing requests to prevent attackers from using DNS rebinding to access internal resources
- **SEC-003**: Command injection prevention - uses `execFileAsync` instead of shell execution for all subprocess calls, eliminating shell interpretation vulnerabilities
- **SEC-004**: Path traversal prevention - validates output paths with symlink resolution using `fs.realpath()` to prevent TOCTOU attacks; restricts output to allowed directories (`~/Desktop/Screenshots`, `~/Downloads`, `~/Documents`, `/tmp`)
- **SEC-005**: DoS protection - limits concurrent Puppeteer instances to 3 via semaphore to prevent resource exhaustion attacks
- SSRF prevention with comprehensive IP blocking:
  - IPv4: loopback (127.x.x.x), private networks (10.x.x.x, 172.16-31.x.x, 192.168.x.x), link-local/metadata (169.254.x.x)
  - IPv6: loopback (::1), link-local (fe80::/10), unique local (fc00::/7), IPv4-mapped addresses
- App name validation pattern for window capture to prevent injection via Swift code execution

[Unreleased]: https://github.com/sethbang/mcp-screenshot-server/compare/v1.2.0...HEAD
[1.2.0]: https://github.com/sethbang/mcp-screenshot-server/compare/v1.1.2...v1.2.0
[1.1.2]: https://github.com/sethbang/mcp-screenshot-server/compare/v1.1.1...v1.1.2
[1.1.1]: https://github.com/sethbang/mcp-screenshot-server/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/sethbang/mcp-screenshot-server/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/sethbang/mcp-screenshot-server/releases/tag/v1.0.0
