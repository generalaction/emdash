import { initLogger } from 'evlog';
import { evlog, type EvlogVariables } from 'evlog/hono';
import { Hono, type Context } from 'hono';
import {
  SHARE_MAX_PAYLOAD_BYTES,
  sharedPromptSchema,
  sharedSkillSchema,
  shareFetchResponseSchema,
  type SharePayload,
  type ShareType,
} from '../../../src/shared/share';

type Env = {
  DB: D1Database;
  SHARE_CREATE_LIMITER?: RateLimit;
};

type ShareRow = {
  id: string;
  type: ShareType;
  payload: string;
  created_at: number;
};

initLogger({ env: { service: 'emdash-share' } });

const app = new Hono<{ Bindings: Env } & EvlogVariables>();
type ShareContext = Context<{ Bindings: Env } & EvlogVariables>;
const encoder = new TextEncoder();
const createLimitPerWindow = 60;
const rateLimitWindowSeconds = 60;

app.use(evlog());

app.onError((error, c) => {
  const url = new URL(c.req.url);
  const log = c.get('log');

  log.set({
    event: 'request_error',
    method: c.req.method,
    path: url.pathname,
    cfRay: c.req.header('CF-Ray'),
    userAgent: c.req.header('User-Agent'),
  });
  log.error(error);

  return c.json({ error: 'Internal server error' }, 500);
});

app.post('/api/skills', async (c) => createShare(c, 'skill'));
app.post('/api/prompts', async (c) => createShare(c, 'prompt'));
app.get('/api/skills/:id', async (c) => getShareJson(c, 'skill'));
app.get('/api/prompts/:id', async (c) => getShareJson(c, 'prompt'));
app.get('/skills/:id', async (c) => getSharePage(c, 'skill'));
app.get('/prompts/:id', async (c) => getSharePage(c, 'prompt'));

app.get('/', (c) => c.redirect('https://emdash.sh', 302));

async function createShare(c: ShareContext, type: ShareType) {
  const rawBody = await c.req.text();
  if (encoder.encode(rawBody).byteLength > SHARE_MAX_PAYLOAD_BYTES) {
    return c.json({ error: 'Payload too large' }, 413);
  }

  const rateLimited = await isRateLimited(c);
  if (rateLimited) {
    c.get('log').set({ event: 'share_rate_limited', share: { type } });
    return c.json({ error: 'Too many share links created. Try again later.' }, 429);
  }

  let body: unknown;
  try {
    body = rawBody ? JSON.parse(rawBody) : null;
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  const parsedPayload = parseCreatePayload(type, body);
  if (!parsedPayload) return c.json({ error: 'Invalid share payload' }, 400);

  const id = createShareId();
  await c.env.DB.prepare('INSERT INTO shares (id, type, payload) VALUES (?, ?, ?)')
    .bind(id, type, JSON.stringify(parsedPayload))
    .run();

  c.get('log').set({ event: 'share_created', share: { id, type } });

  return c.json({ id, url: `${new URL(c.req.url).origin}/${typeToPath(type)}/${id}` }, 201);
}

async function getShareJson(c: ShareContext, type: ShareType) {
  const id = c.req.param('id');
  if (!id) return c.json({ error: 'Share not found' }, 404);

  const row = await getShare(c.env.DB, type, id);
  if (!row) return c.json({ error: 'Share not found' }, 404);

  const parsed = parseStoredShare(row);
  if (!parsed) {
    c.get('log').set({ event: 'invalid_stored_share', share: { id, type } });
    return c.json({ error: 'Invalid stored share' }, 500);
  }

  return c.json(parsed);
}

async function getSharePage(c: ShareContext, type: ShareType) {
  const id = c.req.param('id');
  if (!id) return c.html(renderNotFoundPage(type), 404);

  const row = await getShare(c.env.DB, type, id);
  if (!row) {
    return c.html(renderNotFoundPage(type), 404);
  }

  const parsed = parseStoredShare(row);
  if (!parsed) {
    c.get('log').set({ event: 'invalid_stored_share', share: { id, type } });
    return c.html(renderNotFoundPage(type), 500);
  }

  return c.html(renderSharePage(c.req.url, parsed));
}

async function getShare(db: D1Database, type: ShareType, id: string): Promise<ShareRow | null> {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return null;

  return await db
    .prepare(
      'SELECT id, type, payload, created_at FROM shares WHERE id = ? AND type = ? AND revoked_at IS NULL'
    )
    .bind(id, type)
    .first<ShareRow>();
}

function parseStoredShare(row: ShareRow) {
  try {
    return shareFetchResponseSchema.parse({
      id: row.id,
      createdAt: row.created_at,
      payload: JSON.parse(row.payload),
    });
  } catch {
    return null;
  }
}

async function isRateLimited(c: ShareContext): Promise<boolean> {
  const ip = c.req.header('CF-Connecting-IP') ?? 'unknown';
  const path = new URL(c.req.url).pathname;
  const key = await hashKey(`${ip}:${path}`);

  if (c.env.SHARE_CREATE_LIMITER) {
    const result = await c.env.SHARE_CREATE_LIMITER.limit({ key });
    if (!result.success) return true;
  }

  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - (now % rateLimitWindowSeconds);
  const existing = await c.env.DB.prepare(
    'SELECT count FROM share_rate_limits WHERE key = ? AND window_start = ?'
  )
    .bind(key, windowStart)
    .first<{ count: number }>();

  if ((existing?.count ?? 0) >= createLimitPerWindow) return true;

  await c.env.DB.prepare(
    `INSERT INTO share_rate_limits (key, window_start, count)
     VALUES (?, ?, 1)
     ON CONFLICT(key, window_start) DO UPDATE SET count = count + 1`
  )
    .bind(key, windowStart)
    .run();

  return false;
}

function parseCreatePayload(type: ShareType, body: unknown): SharePayload | null {
  if (type === 'skill') {
    const result = sharedSkillSchema.safeParse(body);
    return result.success ? { type: 'skill', skill: result.data } : null;
  }

  const result = sharedPromptSchema.safeParse(body);
  return result.success ? { type: 'prompt', prompt: result.data } : null;
}

async function hashKey(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function createShareId(): string {
  const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => alphabet[byte % alphabet.length]).join('');
}

function typeToPath(type: ShareType): string {
  return type === 'skill' ? 'skills' : 'prompts';
}

function renderSharePage(url: string, share: NonNullable<ReturnType<typeof parseStoredShare>>) {
  const origin = new URL(url).origin;
  const pathType = typeToPath(share.payload.type);
  const title =
    share.payload.type === 'skill'
      ? `Emdash Skill: ${share.payload.skill.displayName}`
      : `Emdash Prompt: ${share.payload.prompt.title}`;
  const description =
    share.payload.type === 'skill' ? share.payload.skill.description : share.payload.prompt.prompt;
  const content =
    share.payload.type === 'skill'
      ? share.payload.skill.skillMdContent
      : share.payload.prompt.prompt;
  const deepLink = `emdash://share/${pathType}/${share.id}`;

  return htmlDocument({
    title,
    description,
    body: `
      <main>
        <section class="header">
          <p class="eyebrow">${share.payload.type === 'skill' ? 'Skill' : 'Prompt'}</p>
          <h1>${escapeHtml(title)}</h1>
          <p>${escapeHtml(description)}</p>
          <div class="actions">
            <a class="primary" href="${escapeAttribute(deepLink)}">Open in Emdash</a>
            <button type="button" data-copy>Copy</button>
            <a href="https://emdash.sh">Download Emdash</a>
          </div>
        </section>
        <pre><code>${escapeHtml(content)}</code></pre>
      </main>
      <script>
        const button = document.querySelector('[data-copy]');
        button?.addEventListener('click', async () => {
          await navigator.clipboard.writeText(${JSON.stringify(content)});
          button.textContent = 'Copied';
          setTimeout(() => button.textContent = 'Copy', 1600);
        });
      </script>
    `,
    ogUrl: `${origin}/${pathType}/${share.id}`,
  });
}

function renderNotFoundPage(type: ShareType) {
  return htmlDocument({
    title: 'Share not found',
    description: `This Emdash ${type} share link is unavailable.`,
    body: `
      <main>
        <section class="header">
          <p class="eyebrow">Emdash</p>
          <h1>Share not found</h1>
          <p>This link may have been revoked or typed incorrectly.</p>
          <div class="actions">
            <a class="primary" href="https://emdash.sh">Download Emdash</a>
          </div>
        </section>
      </main>
    `,
  });
}

function htmlDocument({
  title,
  description,
  body,
  ogUrl,
}: {
  title: string;
  description: string;
  body: string;
  ogUrl?: string;
}) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeAttribute(description)}" />
    <meta property="og:title" content="${escapeAttribute(title)}" />
    <meta property="og:description" content="${escapeAttribute(description)}" />
    <meta property="og:type" content="website" />
    ${ogUrl ? `<meta property="og:url" content="${escapeAttribute(ogUrl)}" />` : ''}
    <style>
      :root { color-scheme: light dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
      body { margin: 0; background: #f7f7f4; color: #171717; }
      main { width: min(880px, calc(100% - 32px)); margin: 0 auto; padding: 56px 0; }
      .header { display: grid; gap: 16px; margin-bottom: 24px; }
      .eyebrow { color: #6b6b62; font-size: 12px; font-weight: 700; margin: 0; text-transform: uppercase; }
      h1 { font-size: clamp(32px, 5vw, 56px); line-height: 1; margin: 0; letter-spacing: 0; }
      p { color: #4d4d46; font-size: 16px; line-height: 1.55; margin: 0; max-width: 680px; }
      .actions { display: flex; flex-wrap: wrap; gap: 10px; }
      a, button { border: 1px solid #c9c8bf; border-radius: 8px; color: inherit; cursor: pointer; font: inherit; padding: 10px 14px; text-decoration: none; }
      button { background: transparent; }
      .primary { background: #171717; border-color: #171717; color: white; }
      pre { background: #ffffff; border: 1px solid #deddd4; border-radius: 8px; overflow: auto; padding: 18px; white-space: pre-wrap; }
      code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; line-height: 1.55; }
      @media (prefers-color-scheme: dark) {
        body { background: #11110f; color: #f4f4ef; }
        p, .eyebrow { color: #aaa89f; }
        a, button { border-color: #3d3c37; }
        .primary { background: #f4f4ef; border-color: #f4f4ef; color: #11110f; }
        pre { background: #191916; border-color: #33322d; }
      }
    </style>
  </head>
  <body>${body}</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/\n/g, ' ');
}

export default app;
