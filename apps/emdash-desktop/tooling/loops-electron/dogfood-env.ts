import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';

const [command, sourcePath, targetPath, origin] = process.argv.slice(2);

if (command === 'app' && sourcePath && targetPath) {
  updateAppOrigin(sourcePath, targetPath);
  process.exit(0);
}

if (command !== 'project' || !sourcePath || !targetPath) {
  throw new Error(
    'Usage: dogfood-env.ts project <source .env.local> <target projection> [app origin] | app <.env.local> <app origin>'
  );
}

const source = parseDotEnv(readFileSync(sourcePath, 'utf8'));
const appOrigin = origin ?? 'http://127.0.0.1:3000';
assertSafeLoopbackOrigin(appOrigin);

const required = ['AGENT_LOGIN_PASSWORD', 'GOOGLE_GEMINI_API_KEY'] as const;
for (const key of required) {
  assert.ok(source[key], `${key} is missing from the preserved Summario environment`);
}

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwtPrivateKey = privateKey
  .export({ format: 'pem', type: 'pkcs8' })
  .toString()
  .trimEnd()
  .replace(/\n/g, ' ');
const jwks = JSON.stringify({
  keys: [{ use: 'sig', ...publicKey.export({ format: 'jwk' }) }],
});

const projection = [
  `AGENT_LOGIN_PASSWORD=${quoteDotEnv(source.AGENT_LOGIN_PASSWORD)}`,
  `GOOGLE_GEMINI_API_KEY=${quoteDotEnv(source.GOOGLE_GEMINI_API_KEY)}`,
  `JWT_PRIVATE_KEY=${quoteDotEnv(jwtPrivateKey)}`,
  `JWKS=${jwks}`,
  `SITE_URL=${quoteDotEnv(appOrigin)}`,
  'SUMMARIO_BROWSER_FIXTURES=local',
  'WORKOS_CLIENT_ID=client_emdash_wave5_local_nonfunctional',
  'WORKOS_API_KEY=sk_test_emdash_wave5_local_nonfunctional',
  'WORKOS_WEBHOOK_SECRET=whsec_emdash_wave5_local_nonfunctional',
  'WORKOS_ACTION_SECRET=action_emdash_wave5_local_nonfunctional',
].join('\n');

writeFileSync(targetPath, `${projection}\n`, { mode: 0o600 });
chmodSync(targetPath, 0o600);
process.stdout.write(
  'Wrote mode-0600 Wave 5 Convex projection with fresh auth keys, required secret keys, local-only WorkOS placeholders, and loopback origin.\n'
);

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

function quoteDotEnv(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r/g, '\\r').replace(/\n/g, '\\n')}"`;
}

function updateAppOrigin(path: string, value: string): void {
  assertSafeLoopbackOrigin(value);
  const lines = readFileSync(path, 'utf8').split(/\r?\n/);
  setAssignment(lines, 'NEXT_PUBLIC_APP_URL', value);
  setAssignment(lines, 'NEXT_PUBLIC_SUMMARIO_AUTH_MODE', 'legacy');
  setAssignment(lines, 'SUMMARIO_BROWSER_FIXTURES', 'local');
  writeFileSync(path, `${lines.join('\n').replace(/\n+$/, '')}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
  process.stdout.write('Updated the preserved Wave 5 app environment to the canonical origin.\n');
}

function setAssignment(lines: string[], key: string, value: string): void {
  const assignment = `${key}=${quoteDotEnv(value)}`;
  const matcher = new RegExp(`^\\s*${key}\\s*=`);
  const index = lines.findIndex((line) => matcher.test(line));
  if (index === -1) lines.push(assignment);
  else lines[index] = assignment;
}

function assertSafeLoopbackOrigin(value: string): void {
  const parsed = new URL(value);
  assert.equal(parsed.protocol, 'http:', 'Dogfood app origin must use local HTTP');
  assert.ok(
    parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost',
    'Dogfood app origin must be loopback'
  );
  assert.equal(parsed.pathname, '/', 'Dogfood app origin must not include a path');
  assert.equal(parsed.search, '', 'Dogfood app origin must not include a query');
  assert.equal(parsed.hash, '', 'Dogfood app origin must not include a fragment');
}
