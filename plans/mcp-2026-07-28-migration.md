# MCP 2026-07-28 / SDK v2 — investigation & migration plan

Investigated 2026-08-22 against spec revision `2026-07-28` (released 2026-07-28) and
the v2 TypeScript SDK packages at `2.0.0`.

> **STATUS: executed 2026-08-24** on branch `feat/mcp-sdk-v2`, shipped as `1.4.0`.
> Everything in the change list below was applied. Verification: `npm run build` and
> `npm run lint` clean; `npm run test:all` → 234 passed, 8 skipped (the skips are the
> pre-existing `skipIf(!isLinux)` cases). Both protocol eras smoke-tested against the
> built `build/index.js`, and `--doctor` confirmed still working.
>
> Also verified the **probe-then-fallback sequence on a single connection** — a
> 2026-era client sending a claim-less `server/discover`, getting `-32601`, and then
> falling back to `initialize` on the *same* connection. The connection survives the
> probe: `id 1 → -32601`, `id 2 → negotiated 2025-06-18`, `tools/list` and
> `tools/call` both fine afterward. This matters because `serveStdio` pins the era at
> the opening exchange, and the opening exchange here is the failed probe.
>
> Note that neither `npm run build` (tsconfig excludes `tests/**/*`) nor `npm run
> lint` (`eslint src/`) typechecks the test files, and vitest strips types without
> checking them — so the test edits were separately typechecked with a throwaway
> tsconfig covering `src` + `tests`. Clean. This blind spot is pre-existing; a
> `typecheck` script covering tests would be a reasonable follow-up.
>
> One deviation from the plan: `server.json`'s `$schema` was left at `2025-12-11`.
> Probed the registry — no newer schema is published (`2026-07-28` and `2026-08-01`
> both 404).
>
> Also updated beyond the original list: `CLAUDE.md`, whose architecture section
> described the old `server.tool()` / hand-wired-transport wiring.

## TL;DR — nothing is forcing this

**The release necessitates no changes to this server.** There is no forcing function:
`@modelcontextprotocol/sdk@1.30.0` keeps working, every currently-installed client
keeps working, and the spec changes touch nothing this server implements. Doing
nothing breaks nothing.

Given that, the facts relevant to a go/no-go:

1. **`@modelcontextprotocol/sdk@2.0.0` does not exist.** `dist-tags.latest` for that
   package is still `1.30.0`. v2 shipped as a *package split*:
   `@modelcontextprotocol/server`, `@modelcontextprotocol/client`,
   `@modelcontextprotocol/core`, all at `2.0.0`. So the upgrade is a dependency
   replacement plus a zod major, not a version bump.
2. **A stdio, tools-only server is the least-affected shape in this release** — see
   the table below.
3. **If you do migrate, the job is small and fully mechanical**: 4 source files,
   6 test files, 3 dependency lines. The real cost is the zod 3 → 4 major.
4. **Backward compatibility is preserved by default** — verified empirically, below.
5. The forward-looking argument for migrating: v1.x does not support 2026-07-28 at
   all, and the migration only gets more awkward as v1 ages.

## Why the spec changes don't affect us

Every headline item in 2026-07-28 is either Streamable-HTTP-only or a feature this
server doesn't implement:

| Change | Impact here |
|---|---|
| Stateless core; `initialize`/`Mcp-Session-Id` removed | HTTP transport concern; stdio handled by SDK |
| `subscriptions/listen` replaces GET stream + `resources/subscribe` | No resources, no subscriptions |
| Header-based routing (`Mcp-Method`, `Mcp-Name`) | Streamable HTTP only |
| Multi Round-Trip Requests (`input_required`) | Opt-in; no elicitation/sampling used |
| Cacheable list results (`ttlMs`, `cacheScope`) | SDK emits these automatically |
| Tasks moved to an extension | Not used |
| Authorization hardening (RFC 9207, CIMD) | No auth; stdio |
| `ping`, `logging/setLevel`, roots list-changed removed | Not used |
| **Roots / Sampling / Logging deprecated** (SEP-2577) | Not used. The recommended replacement for Logging is "log to stderr on stdio" — which `src/index.ts` already does via `console.error` |
| Deterministic `tools/list` ordering (SHOULD) | Already satisfied: two tools, fixed registration order |
| `inputSchema` loosened to full JSON Schema 2020-12 | Purely permissive |
| HTTP+SSE transport reclassified Deprecated | Not used |

Nothing on that list requires a code change.

## Verified empirically (not read from docs)

Built a probe mirroring this repo's exact registration code against the real v2
packages, compiled with this project's `tsconfig.json` and TypeScript 6.0.3.

- `tsc --noEmit` → **exit 0**, for both the wrapped `z.object({...})` form and the
  legacy raw-shape form. The hand-rolled `McpToolResponse` in `src/types/index.ts`
  still satisfies v2's tool-result type.
- **Legacy client works.** Driving the v2 server over stdio with a 2025-06-18
  `initialize` handshake → server negotiates `2025-06-18`, `tools/list` and
  `tools/call` both return correctly, with no `resultType` field added. This is
  `serveStdio`'s default `legacy: 'serve'`.
- **Modern client works.** A `2026-07-28` request with the full `_meta` envelope
  returns `resultType: "complete"`, `ttlMs`, `cacheScope`, and
  `io.modelcontextprotocol/serverInfo` — all synthesized by the SDK.
- `server/discover` responds correctly under a modern envelope, and returns
  `-32601 Method not found` to a claim-less probe. That is the designed
  backward-compatibility probe behaviour, not a bug.
- **The in-memory path survives unchanged.** `tests/e2e/mcp-protocol.e2e.test.ts`
  never goes through `serveStdio` — it wires a `Client` to an `McpServer` over
  `InMemoryTransport`, so none of the era-negotiation findings above applied to it.
  Probed separately: `InMemoryTransport.createLinkedPair()`,
  `mcpServer.connect(transport)`, `client.listTools()` and `client.callTool()` all
  survive v2 with identical shapes, and the round-trip returns the expected result.
  That file is therefore a mechanical import rename, nothing more.

### Symbol locations confirmed

| Symbol | v1 | v2 |
|---|---|---|
| `McpServer` | `@modelcontextprotocol/sdk/server/mcp.js` | `@modelcontextprotocol/server` (root) |
| `StdioServerTransport` | `@modelcontextprotocol/sdk/server/stdio.js` | `@modelcontextprotocol/server/stdio` |
| `serveStdio` (new, preferred) | — | `@modelcontextprotocol/server/stdio` |
| `Client` | `@modelcontextprotocol/sdk/client/index.js` | `@modelcontextprotocol/client` (root) |
| `InMemoryTransport` | `@modelcontextprotocol/sdk/inMemory.js` | root of both `server` and `client` |

## The one decision that carries risk

`universal-screenshot-mcp` is published and installed in people's clients. Leave
`serveStdio`'s `legacy` option at its default `'serve'`. Passing `legacy: 'reject'`
would refuse every currently-installed 2025-era client. This is a deliberate choice,
not an omission.

## Change list

**Dependencies (3 lines)**
- Remove `@modelcontextprotocol/sdk`, add `@modelcontextprotocol/server@^2.0.0`
- Add `@modelcontextprotocol/client@^2.0.0` as a **devDependency** — only
  `tests/e2e/mcp-protocol.e2e.test.ts` needs it, and it must not ship to consumers
- `zod` `^3.25.76` → `^4.2.0` (v2 requires it; zod 3 shapes fail *silently at
  runtime*, so this is not optional)
- `engines` already `^22.13.0 || >=24`, satisfies v2's `>=20` — leave alone

**Source (4 files)**
- `src/server.ts` — import `McpServer` from `@modelcontextprotocol/server`
- `src/tools/take-screenshot.ts`, `src/tools/take-system-screenshot.ts` — same import
  change; wrap `inputSchema` shapes in `z.object({...})` (raw shapes are
  deprecated-with-overload)
- `src/index.ts` — `serveStdio(() => createServer())` from
  `@modelcontextprotocol/server/stdio`. Keep the `--doctor` early-exit *before* it;
  `serveStdio` takes a factory so ordering is preserved.

**Tests (6 files touch the SDK)**

Five hardcode `vi.mock('@modelcontextprotocol/sdk/server/mcp.js')` and need the new
specifier `@modelcontextprotocol/server`:
`tests/tools/take-screenshot.test.ts`,
`tests/tools/take-screenshot.integration.test.ts`,
`tests/tools/take-system-screenshot.test.ts`,
`tests/tools/take-system-screenshot.e2e.test.ts`,
`tests/tools/take-system-screenshot-linux.e2e.test.ts`.

The sixth, `tests/e2e/mcp-protocol.e2e.test.ts`, needs `Client` →
`@modelcontextprotocol/client` and `InMemoryTransport` →
`@modelcontextprotocol/server`. Its `inputSchema.properties` assertions at lines
52–61 were confirmed still passing against v2 output.

One non-mechanical spot: `tests/tools/take-system-screenshot.test.ts` reconstructs a
zod object from the captured *raw shape* —
`z.object(capturedSchema.inputSchema as Record<string, ZodType>)` at lines 230 and
236. Wrapping `inputSchema` in `z.object()` in source breaks this, since it becomes
`z.object(zodObject)`. Use the captured schema directly and drop the `z.object(...)`
call. The `capturedSchema` type annotation at line 49
(`{ inputSchema: Record<string, unknown> }`) changes with it, as does the now-unused
`ZodType` import at line 62.

**zod 4 schema-output note:** `z.number().int().min(0)` now emits
`"maximum": 9007199254740991` in the generated JSON Schema. Harmless, but it is the
kind of thing a generated-output assertion would trip on.

**Housekeeping**
- `CHANGELOG.md` entry + version bump. `1.4.0` is defensible — consumers see no API change.
- `server.json` is at `1.2.0` while `package.json` is `1.3.0`. Already out of sync;
  worth fixing in the same pass. Its `$schema` points at the `2025-12-11` registry
  schema — check whether the registry has published a newer one.

## Approach notes

- Branch before starting. `docs/index.html` is untracked and shouldn't get tangled in
  a sweeping rewrite.
- Skip the codemod (`npx @modelcontextprotocol/codemod@latest v1-to-v2 .`). With four
  source import sites, hand-editing beats chasing `@mcp-codemod-error` markers; the
  codemod earns its keep on large codebases.
- Verification gate: `npm run build && npm run lint && npm run test:all`, plus a manual
  legacy-handshake smoke test against the built `build/index.js` to confirm installed
  clients still work.
