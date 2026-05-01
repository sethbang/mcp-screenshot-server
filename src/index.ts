#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';
import { runDoctor, formatDoctorReport } from './utils/doctor.js';
import { commandExists } from './utils/screenshot-provider.js';

const LINUX_BACKENDS = ['maim', 'scrot', 'gnome-screenshot', 'spectacle', 'grim', 'import'];

async function main(): Promise<void> {
  if (process.argv.slice(2).includes('--doctor')) {
    const report = await runDoctor();
    console.log(formatDoctorReport(report));
    process.exit(report.hasFailures ? 1 : 0);
  }

  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Screenshot MCP server running');

  if (process.platform === 'linux') {
    void warnIfMissingLinuxBackend();
  }
}

async function warnIfMissingLinuxBackend(): Promise<void> {
  for (const cmd of LINUX_BACKENDS) {
    if (await commandExists(cmd)) return;
  }
  console.error(
    'Warning: no screenshot tool detected on this Linux system. ' +
    'take_system_screenshot will fail until one is installed. ' +
    'Run `npx universal-screenshot-mcp --doctor` for distro-specific install commands.',
  );
}

main().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
