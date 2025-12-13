import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';

function toSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-');
}

function bufferToDataUrl(buf: Buffer, contentType: string): string {
  const ct = contentType.toLowerCase();
  const mime = ct.startsWith('image/') ? ct : 'image/x-icon';
  return `data:${mime};base64,${buf.toString('base64')}`;
}

function readFileAsDataUrl(abs: string): string | null {
  try {
    const data = fs.readFileSync(abs);
    const ext = path.extname(abs).toLowerCase();
    const mime =
      ext === '.svg'
        ? 'image/svg+xml'
        : ext === '.png'
          ? 'image/png'
          : ext === '.jpg' || ext === '.jpeg'
            ? 'image/jpeg'
            : ext === '.ico'
              ? 'image/x-icon'
              : 'application/octet-stream';
    return bufferToDataUrl(data, mime);
  } catch {
    return null;
  }
}

function getKnownDomain(service: string): string | null {
  const n = service.trim().toLowerCase();
  const map: Record<string, string> = {
    postgres: 'postgresql.org',
    postgresql: 'postgresql.org',
    redis: 'redis.io',
    minio: 'min.io',
    clickhouse: 'clickhouse.com',
    nginx: 'nginx.org',
    mysql: 'mysql.com',
    mariadb: 'mariadb.org',
    mongo: 'mongodb.com',
    mongodb: 'mongodb.com',
    rabbitmq: 'rabbitmq.com',
    kafka: 'apache.org',
    zookeeper: 'apache.org',
  };
  return map[n] ?? null;
}

function allowlisted(domain: string): boolean {
  const allow = new Set([
    'postgresql.org',
    'redis.io',
    'min.io',
    'clickhouse.com',
    'nginx.org',
    'mysql.com',
    'mariadb.org',
    'mongodb.com',
    'rabbitmq.com',
    'apache.org',
  ]);
  return allow.has(domain);
}

async function fetchHttps(
  url: string,
  maxBytes = 200_000
): Promise<{ data: Buffer; contentType: string } | null> {
  return new Promise((resolve) => {
    try {
      https
        .get(url, (res) => {
          const status = res.statusCode || 0;
          const loc = res.headers.location;
          if (status >= 300 && status < 400 && loc && /^https:\/\//i.test(loc)) {
            https
              .get(loc, (res2) => {
                pipeResp(res2);
              })
              .on('error', () => resolve(null));
            return;
          }
          pipeResp(res);

          function pipeResp(r: typeof res) {
            const ct = String(r.headers['content-type'] || '').toLowerCase();
            if (!ct.startsWith('image/')) {
              resolve(null);
              r.resume();
              return;
            }
            const chunks: Buffer[] = [];
            let bytes = 0;
            r.on('data', (chunk: Buffer) => {
              bytes += chunk.length;
              if (bytes > maxBytes) {
                resolve(null);
                r.destroy();
                return;
              }
              chunks.push(chunk);
            });
            r.on('end', () => {
              resolve({ data: Buffer.concat(chunks), contentType: ct });
            });
            r.on('error', () => resolve(null));
          }
        })
        .on('error', () => resolve(null));
    } catch {
      resolve(null);
    }
  });
}

export async function resolveServiceIcon(opts: {
  service: string;
  taskPath?: string;
  allowNetwork?: boolean;
}): Promise<{ ok: true; dataUrl: string } | { ok: false }> {
  const service = opts.service?.trim();
  if (!service) return { ok: false };
  const slug = toSlug(service);

  // 1) Workspace overrides
  if (opts.taskPath) {
    const p = path.join(opts.taskPath, '.emdash', 'service-icons');
    const candidates = ['.svg', '.png', '.jpg', '.jpeg', '.ico'].map((ext) =>
      path.join(p, `${slug}${ext}`)
    );
    for (const abs of candidates) {
      if (fs.existsSync(abs)) {
        const dataUrl = readFileAsDataUrl(abs);
        if (dataUrl) return { ok: true, dataUrl };
      }
    }
  }

  // 2) Cache under userData
  const cacheDir = path.join(app.getPath('userData'), 'icons');
  try {
    fs.mkdirSync(cacheDir, { recursive: true });
  } catch {}
  const cacheFile = path.join(cacheDir, `${slug}.ico`);
  if (fs.existsSync(cacheFile)) {
    const dataUrl = readFileAsDataUrl(cacheFile);
    if (dataUrl) return { ok: true, dataUrl };
  }

  // 3) Optional network fetch to allowlisted domains only
  if (opts.allowNetwork) {
    const domain = getKnownDomain(service);
    if (domain && allowlisted(domain)) {
      const ddgUrl = `https://icons.duckduckgo.com/ip3/${domain}.ico`;
      const directUrl = `https://${domain}/favicon.ico`;
      const fetched = (await fetchHttps(ddgUrl)) || (await fetchHttps(directUrl));
      if (fetched) {
        try {
          fs.writeFileSync(cacheFile, fetched.data);
        } catch {}
        const dataUrl = bufferToDataUrl(fetched.data, fetched.contentType);
        return { ok: true, dataUrl };
      }
    }
  }

  return { ok: false };
}
