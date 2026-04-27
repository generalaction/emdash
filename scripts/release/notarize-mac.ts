import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { RELEASE_DIR } from './lib/config.ts';
import { exec } from './lib/exec.ts';
import { fail, info, step, warn } from './lib/log.ts';

if (process.platform !== 'darwin') {
  console.log('Not macOS — skipping notarization.');
  process.exit(0);
}

const { values } = parseArgs({
  options: {
    'app-bundle': { type: 'string' },
  },
  strict: true,
});

if (!values['app-bundle']) {
  fail('--app-bundle is required (e.g. --app-bundle "Emdash.app")');
}

const appBundle = values['app-bundle'];

const apiKeyPath = process.env.APPLE_API_KEY ?? process.env.APPLE_API_KEY_CONTENT;
const apiKeyId = process.env.APPLE_API_KEY_ID;
const apiIssuer = process.env.APPLE_API_ISSUER;

if (!apiKeyPath || !apiKeyId || !apiIssuer) {
  warn('Apple API key not configured; skipping notarization.');
  process.exit(0);
}

let keyFile = apiKeyPath;
if (apiKeyPath.includes('BEGIN PRIVATE KEY') || apiKeyPath.length > 500) {
  const { writeFileSync } = await import('node:fs');
  keyFile = join(tmpdir(), `apple_api_key_${Date.now()}.p8`);
  writeFileSync(keyFile, apiKeyPath);
}

const dmgs = readdirSync(RELEASE_DIR)
  .filter((f) => f.endsWith('.dmg'))
  .map((f) => join(RELEASE_DIR, f));

if (dmgs.length === 0) {
  warn('No DMG files found — nothing to notarize.');
  process.exit(0);
}

for (const dmg of dmgs) {
  step(`Notarizing ${dmg}`);
  exec(
    `xcrun notarytool submit "${dmg}" --key "${keyFile}" --key-id "${apiKeyId}" --issuer "${apiIssuer}" --wait`,
    { echo: true }
  );

  info('Stapling DMG');
  exec(`xcrun stapler staple -v "${dmg}"`, { echo: true });
  exec(`xcrun stapler validate "${dmg}"`, { echo: true });
}

step('Staple app bundles');
const macDirs = readdirSync(RELEASE_DIR)
  .filter((d) => d.startsWith('mac'))
  .map((d) => join(RELEASE_DIR, d, appBundle))
  .filter((p) => existsSync(p));

for (const appDir of macDirs) {
  info(`Stapling ${appDir}`);
  try {
    exec(`xcrun stapler staple "${appDir}"`, { echo: true });
    exec(`xcrun stapler validate "${appDir}"`, { echo: true });
  } catch {
    warn(`App staple failed for ${appDir} (may not be individually notarized)`);
  }
}

step('Gatekeeper check (app inside DMG)');
for (const dmg of dmgs) {
  const mnt = mkdtempSync(join(tmpdir(), 'dmg-'));
  try {
    exec(`hdiutil attach "${dmg}" -mountpoint "${mnt}" -nobrowse -quiet`, { echo: true });
    const appPath = join(mnt, appBundle);
    if (!existsSync(appPath)) {
      fail(`No ${appBundle} found inside ${dmg}`);
    }
    exec(`spctl -a -vv --type execute "${appPath}"`, { echo: true });
    info(`Gatekeeper passed for ${dmg}`);
  } finally {
    try {
      exec(`hdiutil detach "${mnt}" -quiet`);
    } catch {
      /* best effort */
    }
    rmSync(mnt, { recursive: true, force: true });
  }
}
