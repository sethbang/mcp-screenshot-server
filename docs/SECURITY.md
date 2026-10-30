# Security Model

This document describes the security controls implemented in the MCP Screenshot Server and the threats they mitigate.

## Threat Model

The server accepts instructions from an AI assistant (via MCP) to capture screenshots. Because the AI's prompts originate from user input, the server must defend against:

1. **Server-Side Request Forgery (SSRF)** — Attacker tricks the server into making requests to internal services
2. **DNS Rebinding** — Attacker's domain resolves to a public IP during validation but a private IP during the actual request
3. **Command Injection** — Attacker injects shell commands via tool parameters
4. **Path Traversal** — Attacker writes screenshots outside allowed directories
5. **Denial of Service** — Attacker exhausts server resources through concurrent heavy operations

---

## SEC-001: SSRF and DNS Rebinding Prevention

**File:** [`src/validators/url.ts`](../src/validators/url.ts)

### URL Validation

Only `http:` and `https:` protocols are permitted. The validator blocks:

- `localhost` and `localhost.localdomain` by hostname
- IPv6 loopback (`::1`) in bracket notation

### IP Range Blocking

All resolved IP addresses are checked against comprehensive blocklists:

**IPv4 blocked ranges:**

| Range               | Description                    |
|---------------------|--------------------------------|
| `127.0.0.0/8`      | Loopback                       |
| `10.0.0.0/8`       | Private (Class A)              |
| `172.16.0.0/12`    | Private (Class B)              |
| `192.168.0.0/16`   | Private (Class C)              |
| `169.254.0.0/16`   | Link-local / cloud metadata    |
| `0.0.0.0/8`        | Current network                |
| `100.64.0.0/10`    | CGNAT / shared address space   |
| `198.18.0.0/15`    | Benchmark testing              |
| `255.255.255.255`  | Broadcast                      |

**IPv6 blocked ranges:**

| Range             | Description                        |
|-------------------|------------------------------------|
| `::1`             | Loopback                           |
| `fe80::/10`       | Link-local                         |
| `fc00::/7`        | Unique local (ULA)                 |
| `::ffff:x.x.x.x` | IPv4-mapped (checked against IPv4 blocklist) |

### DNS Rebinding Defense

When a hostname (not a literal IP) is provided:

1. The server resolves **all** A and AAAA records via [`dns.lookup()`](../src/validators/url.ts)
2. Every resolved address is checked against the blocklists above
3. If **any** address is blocked, the entire request is rejected
4. The first safe resolved IP is returned as `resolvedIp`
5. Puppeteer is launched with `--host-resolver-rules=MAP <hostname> <resolvedIp>` to **pin** the IP, preventing the browser from re-resolving the domain to a different (potentially internal) address

### Redirect Validation

Puppeteer's request interception validates navigation redirects:

- The original validated URL passes through without re-validation
- Any redirect target is validated through the full [`validateUrl()`](../src/validators/url.ts) pipeline
- Blocked redirects are aborted with `blockedbyclient`
- Sub-resource requests (images, scripts, CSS) are allowed through — they don't pose the same SSRF risk as navigation redirects

---

## SEC-003: Command Injection Prevention

**Files:** [`src/tools/take-system-screenshot.ts`](../src/tools/take-system-screenshot.ts), [`src/utils/macos.ts`](../src/utils/macos.ts), [`src/utils/screenshot-provider.ts`](../src/utils/screenshot-provider.ts), platform providers

All subprocess execution uses `execFile` instead of `exec`. This avoids shell interpretation, so parameters like `outputPath` cannot inject shell metacharacters (`; && | $()` etc.).

Platform-specific protections:
- **macOS**: The [`SAFE_APP_NAME_PATTERN`](../src/config/index.ts) regex (`/^[a-zA-Z0-9 \-_]+$/`) rejects app names containing characters that could be dangerous in the Swift code template used for CoreGraphics window ID lookup.
- **Linux**: All tool invocations use `execFile` with argument arrays — no shell interpolation. Window name lookups via `xdotool` also use `execFile`.
- **Windows**: The PowerShell script body is static and passed via `-EncodedCommand` (base64 UTF-16LE) to `execFile('powershell', ...)`. Untrusted values — `outputPath` and `windowName` — are **never interpolated into script text**. They are passed as environment variables (`SS_OUTPUT_PATH`, `SS_WINDOW_NAME`) through `execFile`'s `env` option and read in the script as `$env:SS_OUTPUT_PATH` / `$env:SS_WINDOW_NAME`, which PowerShell treats as data and never re-parses as code. Escaping is not a viable alternative: PowerShell's tokenizer also treats U+2018–U+201B as single quotes and U+201C–U+201E as double quotes, so doubling ASCII `'` cannot keep a value inside a string literal. Window titles are matched as a literal, case-insensitive substring (`String.IndexOf` with `OrdinalIgnoreCase`), so wildcard characters in `windowName` have no special meaning. Numeric inputs (display index, region coordinates, `windowId`) are validated as integers by the tool's Zod schema before being placed in the script.

---

## SEC-004: Path Traversal Prevention

**File:** [`src/validators/path.ts`](../src/validators/path.ts)

### Symlink Resolution

The validator uses `fs.realpath()` to resolve symlinks **before** checking directory containment. This prevents TOCTOU (time-of-check / time-of-use) attacks where an attacker creates a symlink pointing outside allowed directories.

### Resolution Strategy

1. If the full path exists, `realpath()` resolves it directly
2. If only the parent directory exists, the parent is resolved and the filename is appended
3. If neither exists, validation fails closed (rejects the path)

### Allowed Directories

After symlink resolution, the real path must fall within one of:

- `~/Desktop/Screenshots` (default)
- `~/Downloads`
- `~/Documents`
- `/tmp`

Allowed directories themselves are also resolved via `realpath()` for consistent comparison.

### Additional Protections

- **Null byte injection** — Paths containing `\x00` or `%00` are rejected
- **Relative paths** — Resolved against the default output directory, not the current working directory

---

## SEC-005: Denial of Service Protection

**Files:** [`src/utils/semaphore.ts`](../src/utils/semaphore.ts), [`src/config/runtime.ts`](../src/config/runtime.ts)

Each Puppeteer browser instance spawns a Chromium process consuming 100–500 MB of memory. To prevent resource exhaustion:

- A singleton [`Semaphore`](../src/utils/semaphore.ts) limits concurrent instances to **3** ([`MAX_CONCURRENT_SCREENSHOTS`](../src/config/index.ts))
- The tool uses `tryAcquire()` (non-blocking) — if at capacity, the request is immediately rejected rather than queued
- The semaphore permit is always released in a `finally` block, and the browser is closed **before** the permit is released to avoid briefly exceeding the limit
- An ESLint rule prevents accidental creation of additional `Semaphore` instances outside of [`src/config/runtime.ts`](../src/config/runtime.ts)

The `take_system_screenshot` tool does **not** use a semaphore because native screenshot tools are lightweight (< 100 ms, < 10 MB) across all platforms.

---

## Design Principles

| Principle            | Application                                                                 |
|----------------------|-----------------------------------------------------------------------------|
| **Fail closed**      | DNS errors, unresolvable paths, and unexpected exceptions all result in rejection |
| **Defense in depth** | Multiple independent checks (URL validation → DNS resolution → IP pinning → redirect validation) |
| **Least privilege**  | Only allowed output directories; only http/https protocols; only safe app name characters |
| **No shell access**  | All subprocess calls use `execFile`, never `exec` or `spawn` with `shell: true` |
