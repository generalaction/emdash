import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { APP_BUNDLE, APP_ID, PRODUCT_NAME, RELEASE_DIR } from './lib/config.ts';
import { exec, execOrNull } from './lib/exec.ts';
import { fail, info, step, warn } from './lib/log.ts';

if (process.platform !== 'darwin') {
  console.log('Not macOS — skipping verification.');
  process.exit(0);
}

const { values } = parseArgs({
  options: {
    'smoke-test': { type: 'boolean', default: false },
    'expected-team-id': { type: 'string' },
  },
  strict: true,
});

const smokeTest = values['smoke-test'] ?? false;
const expectedTeamId = values['expected-team-id'];

const macDirs = readdirSync(RELEASE_DIR)
  .filter((d) => d.startsWith('mac'))
  .map((d) => join(RELEASE_DIR, d, APP_BUNDLE))
  .filter((p) => existsSync(p));

if (macDirs.length === 0) {
  fail('No app bundles found to verify');
}

let verified = 0;

for (const appDir of macDirs) {
  const archDir = appDir.split('/').at(-2)!;
  const expectedArch =
    archDir === 'mac-arm64' ? 'arm64' : archDir.startsWith('mac') ? 'x86_64' : null;

  step(`Verifying ${appDir} (expected: ${expectedArch ?? 'unknown'})`);

  const electronBin = join(appDir, 'Contents', 'MacOS', PRODUCT_NAME);
  const sqliteNode = join(
    appDir,
    'Contents',
    'Resources',
    'app.asar.unpacked',
    'node_modules',
    'sqlite3',
    'build',
    'Release',
    'node_sqlite3.node'
  );

  if (expectedArch) {
    const binArch = execOrNull(`file "${electronBin}" | grep -o 'arm64\\|x86_64' | head -1`);
    info(`Electron binary: ${binArch}`);
    if (binArch !== expectedArch) {
      fail(`Electron arch mismatch: got ${binArch}, expected ${expectedArch}`);
    }

    if (existsSync(sqliteNode)) {
      const sqliteArch = execOrNull(`file "${sqliteNode}" | grep -o 'arm64\\|x86_64' | head -1`);
      info(`sqlite3 native module: ${sqliteArch}`);
      if (sqliteArch !== expectedArch) {
        fail(`sqlite3 arch mismatch: got ${sqliteArch}, expected ${expectedArch}`);
      }
    } else {
      warn(`sqlite3 native module not found at ${sqliteNode}`);
    }
  }

  if (smokeTest && archDir === 'mac-arm64') {
    step('Smoke test sqlite3 (arm64)');
    exec(
      `ELECTRON_RUN_AS_NODE=1 NODE_PATH="${appDir}/Contents/Resources/app.asar.unpacked/node_modules" "${electronBin}" -e "require('sqlite3'); console.log('sqlite3 OK')"`,
      { echo: true }
    );
  }

  const plist = join(appDir, 'Contents', 'Info.plist');
  if (existsSync(plist)) {
    const bid =
      execOrNull(`/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "${plist}"`) ??
      execOrNull(
        `plutil -extract CFBundleIdentifier xml1 -o - "${plist}" | sed -n 's/.*<string>\\(.*\\)<\\/string>.*/\\1/p' | head -n1`
      );
    info(`CFBundleIdentifier: ${bid}`);
    if (bid !== APP_ID) {
      fail(`CFBundleIdentifier mismatch (got '${bid}', expected '${APP_ID}')`);
    }
  }

  exec(`codesign --verify --deep --strict --verbose=2 "${appDir}"`, { echo: true });

  if (expectedTeamId) {
    const meta = exec(`codesign -dv --verbose=4 "${appDir}" 2>&1`);
    if (!meta.includes('Authority=Developer ID Application')) {
      fail('Not Developer ID Application signed');
    }
    const tidMatch = meta.match(/TeamIdentifier=(\S+)/);
    const tid = tidMatch?.[1];
    if (tid !== expectedTeamId) {
      fail(`TeamIdentifier mismatch (got '${tid}', expected '${expectedTeamId}')`);
    }
    info(`TeamIdentifier: ${tid}`);
  }

  verified++;
}

info(`Verified ${verified} app bundle(s)`);
