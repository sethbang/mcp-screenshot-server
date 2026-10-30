/**
 * Smoke test for the published entry point over real stdio.
 *
 * mcp-protocol.e2e.test.ts uses InMemoryTransport against createServer(), so
 * nothing else runs the built `bin` the way `npx universal-screenshot-mcp`
 * does. This spawns that file as a child process and talks to it through the
 * SDK's StdioClientTransport, catching packaging breaks (bin path, shebang,
 * exec bit, the package.json version lookup from build/) before release.
 *
 * Requires a build: `npm run build` (CI runs it via `npm ci` → prepare).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/client/stdio';

const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
  name: string;
  version: string;
  bin: Record<string, string>;
};
const binPath = join(process.cwd(), pkg.bin[pkg.name]);

let client: Client;

beforeAll(async () => {
  if (!existsSync(binPath)) {
    throw new Error(`${binPath} not found — run \`npm run build\` before the e2e tests`);
  }

  client = new Client({ name: 'stdio-smoke-test', version: '1.0.0' });
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [binPath],
    env: getDefaultEnvironment(),
    stderr: 'ignore',
  }));
}, 30_000);

afterAll(async () => {
  await client?.close();
});

describe('published entry point over stdio', () => {
  it('bin starts with a node shebang', () => {
    expect(readFileSync(binPath, 'utf8').split('\n')[0]).toBe('#!/usr/bin/env node');
  });

  it.skipIf(process.platform === 'win32')('bin is executable', () => {
    expect(statSync(binPath).mode & 0o111).not.toBe(0);
  });

  it('reports the package.json version in the handshake', () => {
    expect(client.getServerVersion()).toMatchObject({
      name: 'screenshot-server',
      version: pkg.version,
    });
  });

  it('lists both tools', async () => {
    const { tools } = await client.listTools();
    expect(tools.map(t => t.name).sort()).toEqual(['take_screenshot', 'take_system_screenshot']);
  });

  it('runs a real tool call through the real validators', async () => {
    const result = await client.callTool({
      name: 'take_screenshot',
      arguments: { url: 'http://169.254.169.254/latest/meta-data/' },
    });

    expect(result.isError).toBe(true);
    expect((result.content as any)[0]?.text).toContain('URL validation failed');
  });
});
