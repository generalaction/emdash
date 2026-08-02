import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, type Browser, type Page } from 'playwright';

const cdpPort = Number(process.env.EMDASH_LOOPS_DOGFOOD_CDP_PORT);
const appEnvPath = process.env.EMDASH_LOOPS_DOGFOOD_APP_ENV;
assert.ok(Number.isInteger(cdpPort) && cdpPort > 0, 'A positive dogfood CDP port is required');
assert.ok(appEnvPath, 'The preserved dogfood app environment path is required');

const password = parseDotEnv(readFileSync(appEnvPath, 'utf8')).AGENT_LOGIN_PASSWORD;
assert.ok(password, 'The preserved agent-login password is missing');

let stopping = false;
process.once('SIGINT', () => (stopping = true));
process.once('SIGTERM', () => (stopping = true));

let browser: Browser | undefined;
while (!stopping) {
  try {
    browser ??= await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
    for (const page of browser.contexts().flatMap((context) => context.pages())) {
      await authenticateIfNeeded(page, password);
    }
  } catch {
    await browser?.close().catch(() => undefined);
    browser = undefined;
  }
  await delay(500);
}
await browser?.close().catch(() => undefined);

async function authenticateIfNeeded(page: Page, candidate: string): Promise<void> {
  const url = safeUrl(page.url());
  if (!url || url.pathname !== '/auth/agent-login') return;
  assert.ok(
    url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost'),
    'Refusing to authenticate a non-loopback dogfood target'
  );
  const input = page.locator('#agent-password');
  if ((await input.count()) === 0 || !(await input.isVisible().catch(() => false))) return;
  await input.fill(candidate);
  await page.getByRole('button', { name: 'Sign in' }).click();
  try {
    await page.waitForFunction(
      () => location.pathname !== '/auth/agent-login' || !document.querySelector('#agent-password'),
      undefined,
      { timeout: 30_000 }
    );
    const authenticatedUrl = safeUrl(page.url());
    process.stdout.write(
      `Authenticated disposable native browser at ${authenticatedUrl?.origin ?? 'loopback'}.\n`
    );
  } catch (error) {
    await input.fill('').catch(() => undefined);
    throw error;
  }
}

function safeUrl(value: string): URL | undefined {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

function parseDotEnv(contents: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    values[match[1]] = parseValue(match[2]);
  }
  return values;
}

function parseValue(raw: string): string {
  if (raw.startsWith("'") && raw.endsWith("'")) return raw.slice(1, -1);
  if (raw.startsWith('"') && raw.endsWith('"')) {
    return raw.slice(1, -1).replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\"/g, '"');
  }
  return raw.replace(/\s+#.*$/, '').trim();
}
