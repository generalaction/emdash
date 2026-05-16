import { homedir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mcpServerController } from './controller';
import { recentCallsRing } from './recent-calls';

/**
 * Controller-level unit tests. We mock the service + settings-store seams
 * directly so each handler can be exercised in isolation without booting the
 * HTTP transport or hitting the SQLite db.
 */

const mockGetStatus = vi.hoisted(() => vi.fn());
const mockReconcile = vi.hoisted(() => vi.fn());
const mockRotateToken = vi.hoisted(() => vi.fn());
const mockSettingsGet = vi.hoisted(() => vi.fn());
const mockSettingsUpdate = vi.hoisted(() => vi.fn());

vi.mock('./service', () => ({
  mcpServerService: {
    getStatus: mockGetStatus,
    reconcile: mockReconcile,
    rotateToken: mockRotateToken,
  },
  // The controller's `getConfigSnippets` calls `getBridgeCommand()` to build
  // the snippet body. Stub it with a deterministic value so the assertions
  // can pin the substring without depending on the real `process.cwd()`.
  getBridgeCommand: () => ({
    command: 'node',
    args: ['/abs/path/to/out/main/emdash-mcp.js'],
  }),
}));

vi.mock('@main/core/settings/settings-service', () => ({
  appSettingsService: {
    get: mockSettingsGet,
    update: mockSettingsUpdate,
  },
}));

vi.mock('@main/lib/logger', () => ({
  log: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Stub the main-process event bus so loading the singleton ring buffer
// doesn't transitively pull in Electron / the DB client.
vi.mock('@main/lib/events', () => ({
  events: { emit: vi.fn(), on: vi.fn(), once: vi.fn() },
}));

const DEFAULT_SETTINGS = { enabled: false, port: 7457 };

beforeEach(() => {
  mockGetStatus.mockReset();
  mockReconcile.mockReset();
  mockRotateToken.mockReset();
  mockSettingsGet.mockReset();
  mockSettingsUpdate.mockReset();
  mockSettingsGet.mockResolvedValue({ ...DEFAULT_SETTINGS });
  mockSettingsUpdate.mockResolvedValue(undefined);
  mockReconcile.mockResolvedValue(undefined);
  recentCallsRing.clear();
});

describe('mcpServerController', () => {
  describe('getStatus', () => {
    it('proxies through to the service', async () => {
      const status = {
        enabled: true,
        running: true,
        port: 7457,
        tokenPresent: true,
        uptimeMs: 1234,
        lastError: null,
      };
      mockGetStatus.mockResolvedValue(status);
      const result = await mcpServerController.getStatus();
      expect(result).toEqual({ success: true, data: status });
      expect(mockGetStatus).toHaveBeenCalledTimes(1);
    });
  });

  describe('setEnabled', () => {
    it('updates the enabled flag and reconciles', async () => {
      const result = await mcpServerController.setEnabled({ enabled: true });
      expect(result).toEqual({ success: true, data: undefined });
      expect(mockSettingsGet).toHaveBeenCalledWith('mcpServer');
      expect(mockSettingsUpdate).toHaveBeenCalledWith('mcpServer', {
        enabled: true,
        port: 7457,
      });
      expect(mockReconcile).toHaveBeenCalledTimes(1);
    });

    it('returns an Err if the underlying update throws', async () => {
      mockSettingsUpdate.mockRejectedValueOnce(new Error('boom'));
      const result = await mcpServerController.setEnabled({ enabled: true });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toBe('boom');
      expect(mockReconcile).not.toHaveBeenCalled();
    });
  });

  describe('setPort', () => {
    it('updates the port and reconciles', async () => {
      const result = await mcpServerController.setPort({ port: 8000 });
      expect(result).toEqual({ success: true, data: undefined });
      expect(mockSettingsUpdate).toHaveBeenCalledWith('mcpServer', {
        enabled: false,
        port: 8000,
      });
      expect(mockReconcile).toHaveBeenCalledTimes(1);
    });

    it('propagates validation errors as an Err', async () => {
      mockSettingsUpdate.mockRejectedValueOnce(new Error('port out of range'));
      const result = await mcpServerController.setPort({ port: 99999 });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toBe('port out of range');
    });
  });

  describe('rotateToken', () => {
    it('returns the new token and triggers the service rotation', async () => {
      mockRotateToken.mockResolvedValue({ token: 'new-token-xyz' });
      const result = await mcpServerController.rotateToken();
      expect(result).toEqual({ success: true, data: { token: 'new-token-xyz' } });
      expect(mockRotateToken).toHaveBeenCalledTimes(1);
    });

    it('returns an Err if rotation fails', async () => {
      mockRotateToken.mockRejectedValueOnce(new Error('disk full'));
      const result = await mcpServerController.rotateToken();
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toBe('disk full');
    });
  });

  describe('getRecentCalls', () => {
    it('returns whatever is in the ring, most-recent first', async () => {
      recentCallsRing.record({ tool: 'task.create', status: 'ok', ms: 1 });
      recentCallsRing.record({ tool: 'task.list', status: 'ok', ms: 1 });
      const result = await mcpServerController.getRecentCalls();
      expect(result.success).toBe(true);
      if (!result.success) throw new Error('expected ok');
      expect(result.data.map((e) => e.tool)).toEqual(['task.list', 'task.create']);
    });

    it('forwards filter args to the ring', async () => {
      recentCallsRing.record({ tool: 'task.ok', status: 'ok', ms: 1 });
      recentCallsRing.record({ tool: 'task.err', status: 'error', ms: 1, errorCode: 'X' });
      const result = await mcpServerController.getRecentCalls({ status: 'error', limit: 5 });
      expect(result.success).toBe(true);
      if (!result.success) throw new Error('expected ok');
      expect(result.data.map((e) => e.tool)).toEqual(['task.err']);
    });

    it('returns an empty array when the ring is empty', async () => {
      const result = await mcpServerController.getRecentCalls();
      expect(result).toEqual({ success: true, data: [] });
    });
  });

  describe('revealTokenFile', () => {
    it('returns the absolute path to the token file', async () => {
      const result = await mcpServerController.revealTokenFile();
      expect(result.success).toBe(true);
      if (!result.success) throw new Error('expected ok');
      expect(result.data.path).toBe(join(homedir(), '.emdash', 'mcp.json'));
    });
  });

  describe('getConfigSnippets', () => {
    it('produces Claude Code, Cursor, and Codex snippets containing the current port', async () => {
      mockGetStatus.mockResolvedValue({
        enabled: true,
        running: true,
        port: 7457,
        tokenPresent: true,
        uptimeMs: 100,
        lastError: null,
      });
      const result = await mcpServerController.getConfigSnippets();
      expect(result.success).toBe(true);
      if (!result.success) throw new Error('expected ok');
      expect(result.data.claudeCode).toContain('7457');
      expect(result.data.cursor).toContain('7457');
      expect(result.data.codex).toContain('7457');
      // Each snippet should mention the stdio bridge bin name.
      for (const snippet of Object.values(result.data)) {
        expect(snippet).toContain('emdash-mcp');
      }
    });

    it('falls back to the configured port when the server is not running', async () => {
      mockGetStatus.mockResolvedValue({
        enabled: false,
        running: false,
        port: null,
        tokenPresent: false,
        uptimeMs: 0,
        lastError: null,
      });
      mockSettingsGet.mockResolvedValue({ enabled: false, port: 9999 });
      const result = await mcpServerController.getConfigSnippets();
      expect(result.success).toBe(true);
      if (!result.success) throw new Error('expected ok');
      expect(result.data.claudeCode).toContain('9999');
      expect(result.data.codex).toContain('9999');
    });
  });
});
