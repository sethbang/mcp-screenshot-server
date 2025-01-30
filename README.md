# MCP Screenshot Server
[![smithery badge](https://smithery.ai/badge/@sethbang/mcp-screenshot-server)](https://smithery.ai/server/@sethbang/mcp-screenshot-server)

An MCP server implementation that provides screenshot functionality using Puppeteer. This server allows capturing screenshots of web pages and local HTML files through a simple MCP tool interface.

## Features

- Capture screenshots of any web page or local HTML file
- Configurable viewport dimensions
- Full page screenshot support
- Custom output path option
- Automatic screenshot directory management

## Installation

### Installing via Smithery

To install Screenshot Server for Claude Desktop automatically via [Smithery](https://smithery.ai/server/@sethbang/mcp-screenshot-server):

```bash
npx -y @smithery/cli install @sethbang/mcp-screenshot-server --client claude
```

### Manual Installation
```bash
npm install
```

## Usage

The server provides a `take_screenshot` tool with the following options:

```typescript
{
  url: string;         // URL to capture (can be http://, https://, or file:///)
  width?: number;      // Viewport width in pixels (1-3840)
  height?: number;     // Viewport height in pixels (1-2160)
  fullPage?: boolean;  // Capture full scrollable page
  outputPath?: string; // Custom output path (optional)
}
```

## Development

```bash
# Build the project
npm run build

# Run the MCP inspector for testing
npm run inspector
```

## License

MIT
