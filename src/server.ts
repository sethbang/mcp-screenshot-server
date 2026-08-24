import { createRequire } from 'node:module';
import { McpServer } from '@modelcontextprotocol/server';
import { registerTakeScreenshot } from './tools/take-screenshot.js';
import { registerTakeSystemScreenshot } from './tools/take-system-screenshot.js';

const require = createRequire(import.meta.url);
const { version } = require('../package.json') as { version: string };

export function createServer(): McpServer {
  const server = new McpServer({ name: 'screenshot-server', version });
  registerTakeScreenshot(server);
  registerTakeSystemScreenshot(server);
  return server;
}
