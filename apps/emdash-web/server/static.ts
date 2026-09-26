/**
 * Minimal static file server for the built web renderer, with SPA fallback.
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
};

export function createStaticHandler(webRoot: string) {
  const root = resolve(webRoot);
  return function handleStatic(req: IncomingMessage, res: ServerResponse): boolean {
    if (req.method !== 'GET' && req.method !== 'HEAD') return false;
    let urlPath: string;
    try {
      urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
    } catch {
      res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Bad request');
      return true;
    }
    let filePath = normalize(join(root, urlPath));
    if (!filePath.startsWith(root + sep) && filePath !== root) return false;
    if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
      // SPA fallback: unknown non-asset paths get the app shell.
      if (extname(urlPath) === '') {
        filePath = join(root, 'index.html');
        if (!existsSync(filePath)) return false;
      } else {
        return false;
      }
    }
    const type = MIME_TYPES[extname(filePath)] ?? 'application/octet-stream';
    res.writeHead(200, {
      'content-type': type,
      'cache-control': extname(filePath) === '.html' ? 'no-cache' : 'public, max-age=3600',
    });
    if (req.method === 'HEAD') {
      res.end();
      return true;
    }
    createReadStream(filePath).pipe(res);
    return true;
  };
}
