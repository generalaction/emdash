#!/usr/bin/env node
/**
 * Launcher for the emdash CLI.
 *
 * Responsibilities (kept Electron-free so it can run under plain Node OR
 * Electron-as-Node):
 *   1. Resolve EMDASH_DB_FILE to the shared app database BEFORE the bundled CLI
 *      loads, so `@main/db/client` never needs Electron's `app.getPath`.
 *   2. Dynamically import the built bundle (out/main/cli.js), which parses argv
 *      and runs the requested command.
 *
 * Intended to be run via Electron-as-Node so the better-sqlite3 native ABI
 * matches the desktop build:
 *   ELECTRON_RUN_AS_NODE=1 electron bin/emdash-cli.mjs workspace list
 */

import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CURRENT_DB_FILENAME = 'emdash4.db';

function defaultUserDataPath() {
  const home = process.env.HOME ?? os.homedir();
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'emdash');
  }
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming');
    return path.join(appData, 'emdash');
  }
  const xdgConfig = process.env.XDG_CONFIG_HOME ?? path.join(home, '.config');
  return path.join(xdgConfig, 'emdash');
}

if (!process.env.EMDASH_DB_FILE || !process.env.EMDASH_DB_FILE.trim()) {
  process.env.EMDASH_DB_FILE = path.join(defaultUserDataPath(), CURRENT_DB_FILENAME);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const bundlePath = path.resolve(here, '..', 'out', 'cli', 'index.cjs');

try {
  await import(pathToFileURL(bundlePath).href);
} catch (error) {
  if (error && (error.code === 'ERR_MODULE_NOT_FOUND' || error.code === 'MODULE_NOT_FOUND')) {
    process.stderr.write(
      `emdash CLI bundle not found at ${bundlePath}.\nRun \`pnpm build:cli\` first.\n`
    );
    process.exit(1);
  }
  throw error;
}
