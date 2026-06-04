import { initLogger } from 'evlog';
import { evlog, type EvlogVariables } from 'evlog/hono';
import { Hono, type Context } from 'hono';
import {
  SHARE_MAX_PAYLOAD_BYTES,
  sharedAutomationSchema,
  sharedPromptSchema,
  sharedSkillSchema,
  type SharePayload,
  type ShareType,
} from '../../../../src/shared/share';
import { getShareRow, parseStoredShare, typeToPath } from './shares';

export type Env = {
  DB: D1Database;
  SHARE_CREATE_LIMITER?: RateLimit;
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
app.post('/api/automations', async (c) => createShare(c, 'automation'));
app.get('/api/skills/:id', async (c) => getShareJson(c, 'skill'));
app.get('/api/prompts/:id', async (c) => getShareJson(c, 'prompt'));
app.get('/api/automations/:id', async (c) => getShareJson(c, 'automation'));

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

  const row = await getShareRow(c.env.DB, type, id);
  if (!row) return c.json({ error: 'Share not found' }, 404);

  const parsed = parseStoredShare(row);
  if (!parsed) {
    c.get('log').set({ event: 'invalid_stored_share', share: { id, type } });
    return c.json({ error: 'Invalid stored share' }, 500);
  }

  return c.json(parsed);
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

  if (type === 'automation') {
    const result = sharedAutomationSchema.safeParse(body);
    return result.success ? { type: 'automation', automation: result.data } : null;
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

export default app;
