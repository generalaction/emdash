import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  __setEmdashDirForTests,
  checkPermissions,
  ensureTokenFile,
  generateToken,
  getTokenFilePath,
  readTokenFile,
  rotateToken,
  writeTokenFile,
  type McpTokenFile,
} from './token-store';

const isPosix = process.platform !== 'win32';

describe('token-store', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'emdash-token-store-'));
    __setEmdashDirForTests(dir);
  });

  afterEach(() => {
    __setEmdashDirForTests(null);
  });

  describe('generateToken', () => {
    it('returns a non-empty base64url string', () => {
      const token = generateToken();
      expect(token.length).toBeGreaterThan(0);
      // base64url uses [A-Za-z0-9_-] only, no padding.
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it('produces a different token on each call', () => {
      const a = generateToken();
      const b = generateToken();
      expect(a).not.toBe(b);
    });

    it('encodes 32 bytes (43 base64url chars)', () => {
      // 32 bytes -> ceil(32 * 4 / 3) = 43 chars without padding.
      expect(generateToken()).toHaveLength(43);
    });
  });

  describe('getTokenFilePath', () => {
    it('honors the test override and points at <dir>/mcp.json', () => {
      expect(getTokenFilePath()).toBe(join(dir, 'mcp.json'));
    });
  });

  describe('readTokenFile', () => {
    it('returns null when the file does not exist', async () => {
      await expect(readTokenFile()).resolves.toBeNull();
    });

    it('returns null and does not throw on invalid JSON', async () => {
      await writeFile(join(dir, 'mcp.json'), 'not-json{', 'utf8');
      await expect(readTokenFile()).resolves.toBeNull();
    });

    it('returns null when the schema is invalid', async () => {
      await writeFile(
        join(dir, 'mcp.json'),
        JSON.stringify({ version: 2, port: 7457, token: 'abc' }),
        'utf8'
      );
      await expect(readTokenFile()).resolves.toBeNull();
    });

    it('returns null when the token is empty', async () => {
      await writeFile(
        join(dir, 'mcp.json'),
        JSON.stringify({ version: 1, port: 7457, token: '' }),
        'utf8'
      );
      await expect(readTokenFile()).resolves.toBeNull();
    });
  });

  describe('writeTokenFile + readTokenFile round trip', () => {
    it('persists and reads back the same content', async () => {
      const file: McpTokenFile = { version: 1, port: 7457, token: generateToken() };
      await writeTokenFile(file);
      await expect(readTokenFile()).resolves.toEqual(file);
    });

    it('overwrites an existing file atomically', async () => {
      const a: McpTokenFile = { version: 1, port: 7457, token: generateToken() };
      const b: McpTokenFile = { version: 1, port: 7458, token: generateToken() };
      await writeTokenFile(a);
      await writeTokenFile(b);
      await expect(readTokenFile()).resolves.toEqual(b);
      // No leftover .tmp files in the directory.
      const raw = await readFile(getTokenFilePath(), 'utf8');
      expect(raw.trim().endsWith('}')).toBe(true);
    });

    it.runIf(isPosix)('writes the file with mode 0600', async () => {
      await writeTokenFile({ version: 1, port: 7457, token: generateToken() });
      const info = await stat(getTokenFilePath());
      expect(info.mode & 0o777).toBe(0o600);
    });

    it.runIf(isPosix)('creates the parent directory with mode 0700', async () => {
      // Use a fresh nested dir that does not yet exist so writeTokenFile has
      // to create it. Wrapping path keeps the override pointed at a dir we
      // control.
      const nested = join(dir, 'nested', '.emdash');
      __setEmdashDirForTests(nested);
      await writeTokenFile({ version: 1, port: 7457, token: generateToken() });
      const info = await stat(nested);
      expect(info.mode & 0o777).toBe(0o700);
    });
  });

  describe('ensureTokenFile', () => {
    it('creates and returns a new file when none exists', async () => {
      const file = await ensureTokenFile(7457);
      expect(file).toEqual({ version: 1, port: 7457, token: expect.any(String) });
      expect(file.token.length).toBeGreaterThan(0);
      await expect(readTokenFile()).resolves.toEqual(file);
    });

    it('returns the existing file unchanged when port matches', async () => {
      const first = await ensureTokenFile(7457);
      const second = await ensureTokenFile(7457);
      expect(second).toEqual(first);
    });

    it('regenerates the token when the port differs', async () => {
      const first = await ensureTokenFile(7457);
      const second = await ensureTokenFile(7458);
      expect(second.port).toBe(7458);
      expect(second.token).not.toBe(first.token);
    });
  });

  describe('rotateToken', () => {
    it('always produces a different token even at the same port', async () => {
      const first = await ensureTokenFile(7457);
      const rotated = await rotateToken(7457);
      expect(rotated.port).toBe(7457);
      expect(rotated.token).not.toBe(first.token);
      await expect(readTokenFile()).resolves.toEqual(rotated);
    });
  });

  describe('checkPermissions', () => {
    it.runIf(isPosix)('returns ok for a freshly written file (mode 0600)', async () => {
      await writeTokenFile({ version: 1, port: 7457, token: generateToken() });
      await expect(checkPermissions()).resolves.toEqual({ ok: true });
    });

    it.runIf(isPosix)('flags world-readable files', async () => {
      const path = getTokenFilePath();
      await mkdir(dir, { recursive: true });
      await writeFile(path, JSON.stringify({ version: 1, port: 7457, token: 'tok' }), {
        mode: 0o644,
      });
      const result = await checkPermissions();
      expect(result.ok).toBe(false);
      expect(result.warning).toMatch(/insecure permissions/);
      expect(result.warning).toMatch(/644/);
    });

    it.runIf(isPosix)('flags group-readable files', async () => {
      const path = getTokenFilePath();
      await mkdir(dir, { recursive: true });
      await writeFile(path, JSON.stringify({ version: 1, port: 7457, token: 'tok' }), {
        mode: 0o640,
      });
      const result = await checkPermissions();
      expect(result.ok).toBe(false);
      expect(result.warning).toMatch(/640/);
    });

    it.runIf(isPosix)('reports a missing file', async () => {
      const result = await checkPermissions();
      expect(result.ok).toBe(false);
      expect(result.warning).toMatch(/does not exist/);
    });

    it.runIf(!isPosix)('skips the mode check on Windows', async () => {
      // No setup needed: the function should short-circuit on win32.
      await expect(checkPermissions()).resolves.toEqual({ ok: true });
    });
  });
});
