import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { promises as fs } from 'fs';
import { extname, join, normalize, sep } from 'path';
import type { AddressInfo } from 'net';

let serverUrl: string | null = null;
let serverStarted = false;

const MIME_MAP: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.cjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function getMime(filePath: string) {
  return MIME_MAP[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

function isPathInside(parent: string, child: string) {
  const parentPath = normalize(parent + sep);
  const childPath = normalize(child);
  return childPath.startsWith(parentPath);
}

export async function ensureRendererServer(root: string): Promise<string> {
  if (serverStarted && serverUrl) return serverUrl;

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      if (!req.url) {
        res.writeHead(400);
        res.end();
        return;
      }

      const url = new URL(req.url, 'http://localhost');
      const isHead = req.method === 'HEAD';

      const rawPath = decodeURIComponent(url.pathname || '/');
      const safePath = normalize(rawPath).replace(/^(\.\.[/\\])+/, '');
      let filePath = join(root, safePath);

      // Block path traversal
      if (!isPathInside(root, filePath)) {
        res.writeHead(403);
        res.end();
        return;
      }

      let stat;
      try {
        stat = await fs.stat(filePath);
      } catch {
        stat = null;
      }

      if (!stat || stat.isDirectory()) {
        filePath = join(root, 'index.html');
      }

      const data = await fs.readFile(filePath);
      res.writeHead(200, {
        'Content-Type': getMime(filePath),
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      });
      if (!isHead) res.write(data);
      res.end();
    } catch {
      res.writeHead(500);
      res.end();
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo | null;
      if (!addr || typeof addr.port !== 'number') {
        reject(new Error('Failed to start renderer server'));
        return;
      }
      serverUrl = `http://127.0.0.1:${addr.port}/index.html`;
      serverStarted = true;
      resolve();
    });
  });

  return serverUrl!;
}
