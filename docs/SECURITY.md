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

### IP Address Policy

Every IP address — a literal in the URL, every address DNS returns, and the address Chromium actually connected to for each navigation — must be **globally reachable unicast**. Anything else is rejected. Checks are done on parsed addresses ([`isBlockedIp()`](../src/validators/url.ts)), not on string prefixes, so alternative spellings (`::127.0.0.1`, `0:0:0:0:0:0:0:0`, `64:ff9b::169.254.169.254`) are classified the same as their canonical forms.

**IPv4 blocked ranges** (every non-globally-reachable block in the IANA special-purpose registry, plus multicast and reserved space; everything else is public unicast):

| Range               | Description                    |
|---------------------|--------------------------------|
| `0.0.0.0/8`        | "This network" (`0.0.0.0` reaches the local host) |
| `10.0.0.0/8`       | Private (Class A)              |
| `100.64.0.0/10`    | CGNAT / shared address space   |
| `127.0.0.0/8`      | Loopback                       |
| `169.254.0.0/16`   | Link-local / cloud metadata    |
| `172.16.0.0/12`    | Private (Class B)              |
| `192.0.0.0/24`     | IETF protocol assignments      |
| `192.0.2.0/24`     | Documentation (TEST-NET-1)     |
| `192.88.99.0/24`   | 6to4 relay anycast (deprecated) |
| `192.168.0.0/16`   | Private (Class C)              |
| `198.18.0.0/15`    | Benchmark testing              |
| `198.51.100.0/24`  | Documentation (TEST-NET-2)     |
| `203.0.113.0/24`   | Documentation (TEST-NET-3)     |
| `224.0.0.0/4`      | Multicast                      |
| `240.0.0.0/4`      | Reserved, incl. broadcast `255.255.255.255` |

**IPv6 policy** — an allow-list: only global unicast (`2000::/3`) is accepted, minus its special-purpose blocks. Formats that carry an IPv4 address and are routed to it are unwrapped, and the embedded address is re-checked against the IPv4 table above.

| Range                 | Treatment                                              |
|-----------------------|--------------------------------------------------------|
| `::`                  | Blocked — unspecified (connecting to it reaches the local host) |
| `::1`                 | Blocked — loopback                                     |
| `::ffff:0:0/96`       | IPv4-mapped — embedded IPv4 re-checked                 |
| `::/96` (other)       | Blocked — deprecated IPv4-compatible (e.g. `::127.0.0.1`) |
| `64:ff9b::/96`        | NAT64 well-known prefix — embedded IPv4 re-checked (public targets stay reachable on DNS64/NAT64 networks) |
| `2002::/16`           | 6to4 — embedded IPv4 re-checked                        |
| `2001::/23`           | Blocked — IETF protocol assignments (Teredo, benchmarking, ORCHID) |
| `2001:db8::/32`, `3fff::/20` | Blocked — documentation                         |
| `5f00::/16`           | Blocked — SRv6 SIDs                                    |
| Everything outside `2000::/3` | Blocked — incl. link-local `fe80::/10`, ULA `fc00::/7`, multicast `ff00::/8`, local-use NAT64 `64:ff9b:1::/48`, discard `100::/64` |

**`ALLOW_LOCAL=true`** re-opens loopback only: `127.0.0.0/8`, `::1`, and IPv4-mapped loopback (`::ffff:127.x.x.x`). Unspecified addresses (`0.0.0.0`, `::`) and loopback wrapped in IPv4-compatible, NAT64 or 6to4 form stay blocked, as do all private, link-local and metadata ranges.

### DNS Rebinding Defense

When a hostname (not a literal IP) is provided:

1. The server resolves **all** A and AAAA records via [`dns.lookup()`](../src/validators/url.ts)
2. Every resolved address is checked against the policy above
3. If **any** address is blocked — or none is a usable IPv4/IPv6 address — the entire request is rejected
4. The first safe resolved IP is returned as `resolvedIp`
5. Puppeteer is launched with `--host-resolver-rules=MAP <hostname> <resolvedIp>` to **pin** the IP, preventing the browser from re-resolving the domain to a different (potentially internal) address

### Redirect and Frame Validation

Puppeteer's request interception validates every navigation request — main-frame redirects and iframe loads alike:

- The original validated URL passes through without re-validation
- Any other navigation target is validated through the full [`validateUrl()`](../src/validators/url.ts) pipeline
- Blocked navigations are aborted with `blockedbyclient`
- Sub-resource requests (images, scripts, CSS) are allowed through — they don't pose the same SSRF risk as navigation redirects

**Connected-address check.** `--host-resolver-rules` is fixed at launch and pins only the original hostname, so Chromium resolves redirect and iframe hostnames itself, *after* the Node-side check. A rebinding DNS server can answer Node with a public address and Chromium with an internal one. To catch this, the tool inspects the address Chromium actually connected to (`HTTPResponse.remoteAddress()`) for every navigation response, including each redirect hop, and checks it against the same policy. If any is blocked, no screenshot is returned: the capture fails before the screenshot is taken, and a file written while a late navigation was in flight is deleted.

### Residual Risk

- **Blind requests still go out.** The connected-address check runs on the *response*. A rebinding redirect or iframe hostname still causes Chromium to send one request to the internal address; its content never reaches the caller, but any side effect of that GET on the internal service has already happened. Closing this fully would need Chromium to stop resolving names itself (e.g. routing all traffic through a validating proxy), which this server does not do.
- **Sub-resources are not checked.** Images, scripts, stylesheets and `fetch()` calls are neither validated nor pinned, so a page can load (and render, e.g. as an `<img>`) content from internal hosts. Chromium's own Private Network Access restrictions are the only control here.
- **Network-specific NAT64 prefixes.** Only the well-known `64:ff9b::/96` prefix is unwrapped. An operator-assigned NAT64 prefix inside `2000::/3` looks like ordinary global unicast, so on such a network an AAAA record that embeds an internal IPv4 address is not detected.
- **Proxies hide the real destination.** When Chromium sends traffic through a proxy (OS proxy settings, which Chromium honors on macOS and Windows, or a `--proxy-server` flag), `remoteAddress()` reports the proxy, not the origin server. The connected-address check then validates the proxy instead of the site. A proxy on a private address (common for corporate proxies, e.g. `10.x.x.x`) makes every navigation look blocked, so every `take_screenshot` call fails. Behind a proxy, the check gives no rebinding protection either: the proxy resolves hostnames itself.
- **Responses without a remote address** (served from cache, a service worker, or a non-network scheme) cannot be checked. Each capture uses a fresh browser profile, so there is no cache or service worker from a previous run.

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
- **Overall deadline.** Some Puppeteer calls (notably `page.screenshot()`) have no timeout of their own, and a page can wedge them indefinitely. Each `take_screenshot` call therefore races against a hard **120 s** deadline ([`SCREENSHOT_DEADLINE_MS`](../src/config/index.ts)). It sits above the 90 s that the per-step limits can add up to (navigation 30 s, `waitForSelector` 30 s, `waitForTimeout` up to 30 s), so it only fires when something is actually stuck. When it fires, the Chromium process is SIGKILLed rather than closed gracefully, and the permit is released. If the deadline fires while `puppeteer.launch()` is still pending, the browser is killed as soon as launch returns.
- **Close fallback.** A graceful `browser.close()` that takes longer than 5 s is abandoned and the process is SIGKILLed, so a hung close cannot hold the permit either.
- An ESLint rule prevents accidental creation of additional `Semaphore` instances outside of [`src/config/runtime.ts`](../src/config/runtime.ts)

The `take_system_screenshot` tool does **not** use a semaphore because native screenshot tools are lightweight (< 100 ms, < 10 MB) across all platforms.

---

## SEC-006: Popup Blocking

**Files:** [`src/tools/take-screenshot.ts`](../src/tools/take-screenshot.ts)

Puppeteer launches Chromium with `--disable-popup-blocking` by default. That let a page open new windows with `window.open()`, a `target="_blank"` link or form, or the same from inside an iframe. Each popup is a separate target, and the page's request interceptor ([SEC-001](#redirect-and-frame-validation)) never sees its requests. Popups could therefore reach loopback and internal addresses with no SSRF validation at all. An open popup could also make `page.screenshot()` hang forever (see [SEC-005](#sec-005-denial-of-service-protection)).

- The tool launches Chromium with `ignoreDefaultArgs: ['--disable-popup-blocking']`, so Chromium's own popup blocker stays on. The tool never generates a user gesture, so the blocker stops every popup.
- As defense in depth, a `targetcreated` listener closes any new target that has an opener.
- An integration test covers `window.open()`, an anchor click, a form submit and an iframe-originated popup. It asserts that no popup request reaches the server, that the call returns promptly and that the permit is released.

**Residual risk:** the `targetcreated` close is a fallback only. It runs after the popup target exists, so the popup's first request may already have been sent. The popup blocker is the control that actually stops popup requests.

---

## Design Principles

| Principle            | Application                                                                 |
|----------------------|-----------------------------------------------------------------------------|
| **Fail closed**      | DNS errors, unresolvable paths, and unexpected exceptions all result in rejection |
| **Defense in depth** | Multiple independent checks (URL validation → DNS resolution → IP pinning → redirect validation → connected-address check) |
| **Least privilege**  | Only allowed output directories; only http/https protocols; only safe app name characters |
| **No shell access**  | All subprocess calls use `execFile`, never `exec` or `spawn` with `shell: true` |
