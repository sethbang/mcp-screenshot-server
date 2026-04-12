/**
 * E2E tests for the full MCP protocol round-trip.
 *
 * Uses InMemoryTransport and the MCP SDK Client to call tools through the
 * actual JSON-RPC protocol layer — no handler extraction, no mocked McpServer.
 * This exercises tool registration, Zod schema validation, and protocol dispatch.
 *
 * Note: The take_screenshot tool calls validateUrl which blocks 127.0.0.1 by default.
 * For tests that need real Puppeteer screenshots, we test against public URLs or
 * verify that SSRF blocking works correctly through the protocol.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../../src/server.js';

let client: Client;
let cleanup: () => Promise<void>;

beforeAll(async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  const mcpServer = createServer();
  client = new Client({ name: 'test-client', version: '1.0.0' });

  await mcpServer.connect(serverTransport);
  await client.connect(clientTransport);

  cleanup = async () => {
    await client.close();
    await mcpServer.close();
  };
}, 15_000);

afterAll(async () => {
  await cleanup?.();
});

describe('MCP protocol — tool listing', () => {
  it('lists both tools with correct names', async () => {
    const { tools } = await client.listTools();
    const names = tools.map(t => t.name);

    expect(names).toContain('take_screenshot');
    expect(names).toContain('take_system_screenshot');
  });

  it('take_screenshot has url in its input schema', async () => {
    const { tools } = await client.listTools();
    const screenshotTool = tools.find(t => t.name === 'take_screenshot');
    expect(screenshotTool).toBeDefined();
    expect(screenshotTool!.inputSchema).toBeDefined();
    // The Zod schema should expose 'url' as a required property
    expect(screenshotTool!.inputSchema.properties).toHaveProperty('url');
  });

  it('take_system_screenshot has mode in its input schema', async () => {
    const { tools } = await client.listTools();
    const sysTool = tools.find(t => t.name === 'take_system_screenshot');
    expect(sysTool).toBeDefined();
    expect(sysTool!.inputSchema.properties).toHaveProperty('mode');
  });
});

describe('MCP protocol — take_screenshot SSRF prevention', () => {
  it('blocks cloud metadata IP through the protocol', async () => {
    const result = await client.callTool({
      name: 'take_screenshot',
      arguments: { url: 'http://169.254.169.254/latest/meta-data/' },
    });

    expect(result.isError).toBe(true);
    const text = (result.content as any)[0]?.text;
    expect(text).toContain('URL validation failed');
  });

  it('blocks private network IPs through the protocol', async () => {
    const result = await client.callTool({
      name: 'take_screenshot',
      arguments: { url: 'http://10.0.0.1/' },
    });

    expect(result.isError).toBe(true);
    const text = (result.content as any)[0]?.text;
    expect(text).toContain('URL validation failed');
  });

  it('blocks localhost through the protocol', async () => {
    const result = await client.callTool({
      name: 'take_screenshot',
      arguments: { url: 'http://localhost:8080/' },
    });

    expect(result.isError).toBe(true);
    const text = (result.content as any)[0]?.text;
    expect(text).toContain('URL validation failed');
  });

  it('rejects non-http protocols through the protocol', async () => {
    const result = await client.callTool({
      name: 'take_screenshot',
      arguments: { url: 'ftp://example.com/file' },
    });

    expect(result.isError).toBe(true);
    const text = (result.content as any)[0]?.text;
    expect(text).toContain('URL validation failed');
  });
});

describe('MCP protocol — take_system_screenshot', () => {
  it.skipIf(process.platform !== 'darwin')(
    'captures a fullscreen screenshot via the protocol on macOS',
    async () => {
      const result = await client.callTool({
        name: 'take_system_screenshot',
        arguments: { mode: 'fullscreen' },
      });

      // Should succeed — writes to default output dir
      expect(result.isError).toBeUndefined();
      const text = (result.content as any)[0]?.text;
      expect(text).toContain('System screenshot saved');
    },
    30_000,
  );

  it('rejects invalid mode values', async () => {
    const result = await client.callTool({
      name: 'take_system_screenshot',
      arguments: { mode: 'invalid_mode' },
    });

    // Zod validation should reject this at the protocol level
    expect(result.isError).toBe(true);
  });
});
