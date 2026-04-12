import { createServer, type Server } from 'node:http';

export interface TestServer {
  /** Base URL including port, e.g. http://127.0.0.1:12345 */
  url: string;
  /** Shut down the server. Call in afterAll. */
  close: () => Promise<void>;
}

/**
 * Start a local HTTP server on a random port serving test HTML pages.
 * Binds to 127.0.0.1 explicitly so tests can use it with allowLocal.
 */
export function createTestServer(): Promise<TestServer> {
  return new Promise((resolve, reject) => {
    const server: Server = createServer((req, res) => {
      const url = req.url ?? '/';

      if (url === '/simple.html') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><body><div id="target">Hello</div></body></html>');
      } else if (url === '/delayed-element.html') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<html><body>
          <script>setTimeout(() => {
            const el = document.createElement('div');
            el.id = 'delayed';
            el.textContent = 'Appeared';
            document.body.appendChild(el);
          }, 500);</script>
        </body></html>`);
      } else if (url === '/tall-page.html') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<html><body><div style="height:5000px;background:linear-gradient(red,blue)">Tall</div></body></html>`);
      } else if (url === '/redirect-ok') {
        res.writeHead(302, { Location: '/simple.html' });
        res.end();
      } else if (url === '/redirect-evil') {
        res.writeHead(302, { Location: 'http://169.254.169.254/' });
        res.end();
      } else if (url === '/redirect-private') {
        res.writeHead(302, { Location: 'http://10.0.0.1/' });
        res.end();
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    });

    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('Unexpected server address'));
        return;
      }
      resolve({
        url: `http://127.0.0.1:${addr.port}`,
        close: () => new Promise<void>((res, rej) => server.close(err => err ? rej(err) : res())),
      });
    });
  });
}
