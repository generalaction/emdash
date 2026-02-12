import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { promises as fs } from 'fs';
import { extname, join, normalize, sep } from 'path';
import type { AddressInfo } from 'net';

let serverUrl: string | null = null;
let serverStarted = false;

const DEFAULT_RENDERER_PORT = 12112;
const RENDERER_PORT_RANGE = 100;

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

function getRendererPortCandidates(): number[] {
  const raw = process.env.EMDASH_RENDERER_PORT;
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  const start = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_RENDERER_PORT;
  return Array.from({ length: RENDERER_PORT_RANGE }, (_, i) => start + i);
}

async function listenWithFallback(server: ReturnType<typeof createServer>): Promise<AddressInfo> {
  const candidates = getRendererPortCandidates();

  for (const port of candidates) {
    try {
      const addr = await new Promise<AddressInfo>((resolve, reject) => {
        let onError: (error: unknown) => void;
        let onListening: () => void;

        const cleanup = () => {
          server.removeListener('error', onError);
          server.removeListener('listening', onListening);
        };

        onError = (error: unknown) => {
          cleanup();
          reject(error);
        };
        onListening = () => {
          cleanup();
          resolve(server.address() as AddressInfo);
        };

        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(port, '127.0.0.1');
      });

      if (!addr || typeof addr.port !== 'number') {
        throw new Error('Failed to start renderer server');
      }
      return addr;
    } catch (error) {
      const code = (error as any)?.code;
      if (code === 'EADDRINUSE') {
        await new Promise<void>((resolve) => server.close(() => resolve()));
        continue;
      }
      throw error;
    }
  }

  // As a last resort, pick an ephemeral port (should be extremely rare).
  const addr = await new Promise<AddressInfo>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address() as AddressInfo));
  });

  if (!addr || typeof addr.port !== 'number') {
    throw new Error('Failed to start renderer server');
  }
  return addr;
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

  const addr = await listenWithFallback(server);
  serverUrl = `http://127.0.0.1:${addr.port}/index.html`;
  serverStarted = true;

  return serverUrl!;
}
