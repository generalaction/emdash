import { randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { log } from '@main/lib/logger';

/**
 * Persisted shape of `~/.emdash/mcp.json`.
 *
 * The file is bound to a single emdash install. It is read by both the
 * Electron main process (to validate incoming bearer tokens) and the
 * standalone `emdash-mcp` stdio bridge (to authenticate outgoing requests).
 */
export interface McpTokenFile {
  version: 1;
  port: number;
  token: string;
}

const EMDASH_DIR_NAME = '.emdash';
const TOKEN_FILE_NAME = 'mcp.json';

/**
 * Resolves the on-disk location of the token file for the *current* user.
 *
 * Tests should not call this directly — use {@link getTokenFilePath} below,
 * which honors the test-only directory override.
 */
function defaultEmdashDir(): string {
  return join(homedir(), EMDASH_DIR_NAME);
}

let emdashDirOverride: string | null = null;

/**
 * Test-only: redirect token-store filesystem operations to a different
 * directory. Pass `null` to restore the default (`~/.emdash`).
 *
 * Production code MUST NOT call this. It exists so unit tests can use a
 * temporary directory without mutating `process.env.HOME` (which would
 * affect any other code that reads `os.homedir()` during the test run).
 */
export function __setEmdashDirForTests(dir: string | null): void {
  emdashDirOverride = dir;
}

function emdashDir(): string {
  return emdashDirOverride ?? defaultEmdashDir();
}

export function getTokenFilePath(): string {
  return join(emdashDir(), TOKEN_FILE_NAME);
}

async function ensureParentDir(filePath: string): Promise<void> {
  const dir = dirname(filePath);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  // mkdir's mode is masked by umask; tighten explicitly so the directory
  // is owner-only even when the user's umask is permissive.
  if (process.platform !== 'win32') {
    try {
      await chmod(dir, 0o700);
    } catch (err) {
      log.warn('[mcp-server] failed to chmod 0700 on emdash dir', dir, err);
    }
  }
}

function isValidTokenFile(value: unknown): value is McpTokenFile {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  if (obj.version !== 1) return false;
  if (typeof obj.port !== 'number' || !Number.isFinite(obj.port)) return false;
  if (typeof obj.token !== 'string' || obj.token.length === 0) return false;
  return true;
}

export async function readTokenFile(): Promise<McpTokenFile | null> {
  const path = getTokenFilePath();
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    log.warn('[mcp-server] failed to read token file', path, err);
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    log.warn('[mcp-server] token file is not valid JSON', path, err);
    return null;
  }
  if (!isValidTokenFile(parsed)) {
    log.warn('[mcp-server] token file failed validation', path);
    return null;
  }
  return parsed;
}

export async function writeTokenFile(file: McpTokenFile): Promise<void> {
  const path = getTokenFilePath();
  await ensureParentDir(path);
  const tmpPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  const payload = `${JSON.stringify(file, null, 2)}\n`;
  // Write the temp file with mode 0600 so it is never world/group readable,
  // even between the write and the rename.
  await writeFile(tmpPath, payload, { mode: 0o600 });
  if (process.platform !== 'win32') {
    try {
      await chmod(tmpPath, 0o600);
    } catch (err) {
      // If chmod fails we still try to clean up the temp file before
      // surfacing the error.
      await unlink(tmpPath).catch(() => undefined);
      throw err;
    }
  }
  try {
    await rename(tmpPath, path);
  } catch (err) {
    await unlink(tmpPath).catch(() => undefined);
    throw err;
  }
  if (process.platform !== 'win32') {
    // rename preserves the source's mode, but make it explicit on the final
    // path in case the destination existed with a more permissive mode.
    try {
      await chmod(path, 0o600);
    } catch (err) {
      log.warn('[mcp-server] failed to chmod 0600 on token file', path, err);
    }
  }
}

export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

export async function ensureTokenFile(port: number): Promise<McpTokenFile> {
  const existing = await readTokenFile();
  if (existing && existing.port === port) {
    return existing;
  }
  // Per spec: if the file is missing OR its port differs, regenerate the
  // token and write a new file with the requested port. Rotating on port
  // change prevents an attacker who learned the old port+token from
  // continuing to authenticate against the new server.
  const next: McpTokenFile = {
    version: 1,
    port,
    token: generateToken(),
  };
  await writeTokenFile(next);
  return next;
}

export async function rotateToken(port: number): Promise<McpTokenFile> {
  const next: McpTokenFile = {
    version: 1,
    port,
    token: generateToken(),
  };
  await writeTokenFile(next);
  return next;
}

export async function checkPermissions(): Promise<{ ok: boolean; warning?: string }> {
  if (process.platform === 'win32') {
    // POSIX modes do not apply on Windows; ACL inspection is out of scope
    // for v1. The token file lives under the user's profile directory which
    // is access-controlled by default.
    return { ok: true };
  }
  const path = getTokenFilePath();
  let info;
  try {
    info = await stat(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { ok: false, warning: `Token file ${path} does not exist.` };
    }
    return {
      ok: false,
      warning: `Failed to stat token file ${path}: ${(err as Error).message}`,
    };
  }
  // Mask out the file-type bits and look only at the permission bits.
  const mode = info.mode & 0o777;
  if (mode !== 0o600) {
    return {
      ok: false,
      warning: `Token file ${path} has insecure permissions (mode ${mode.toString(8).padStart(3, '0')}); expected 600. Group or other users may be able to read the bearer token.`,
    };
  }
  return { ok: true };
}
