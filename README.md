# MCP Screenshot Server

An MCP server implementation that provides screenshot functionality using Puppeteer. This server allows capturing screenshots of web pages and local HTML files through a simple MCP tool interface.

<a href="https://glama.ai/mcp/servers/@sethbang/mcp-screenshot-server">
  <img width="380" height="200" src="https://glama.ai/mcp/servers/@sethbang/mcp-screenshot-server/badge" alt="Screenshot Server MCP server" />
</a>

## Features

- Capture screenshots of any web page or local HTML file
- Configurable viewport dimensions
- Full page screenshot support
- Custom output path option
- Automatic screenshot directory management

## Installation

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