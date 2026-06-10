import { beforeEach, describe, expect, it, vi } from 'vitest';

const resolveCommandPathMock = vi.hoisted(() =>
  vi.fn<() => Promise<string | null>>().mockResolvedValue(null)
);

vi.mock('@main/core/dependencies/probe', () => ({
  resolveCommandPath: resolveCommandPathMock,
}));

vi.mock('@main/lib/logger', () => ({
  log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const { resolveAgentExecutable, clearResolvedPathCache } =
  await import('./resolve-agent-executable');

const ctx = {} as never;

beforeEach(() => {
  vi.clearAllMocks();
  // Clear the in-memory cache between tests
  clearResolvedPathCache('claude');
  clearResolvedPathCache('codex');
  clearResolvedPathCache('unknown');
});

describe('resolveAgentExecutable', () => {
  describe('installSource = path', () => {
    it('returns cfg.path when the path is valid', async () => {
      resolveCommandPathMock.mockResolvedValue('/usr/local/bin/claude');
      const result = await resolveAgentExecutable({
        providerId: 'claude',
        cfg: { installSource: 'path', path: '/usr/local/bin/claude' },
        binaryName: 'claude',
        ctx,
      });
      expect(result).toBe('/usr/local/bin/claude');
      expect(resolveCommandPathMock).toHaveBeenCalledWith('/usr/local/bin/claude', ctx);
    });

    it('falls through to auto-resolution when path does not exist', async () => {
      // First call: path check fails, second call: auto-resolve succeeds
      resolveCommandPathMock
        .mockResolvedValueOnce(null) // path check
        .mockResolvedValueOnce('/opt/homebrew/bin/claude'); // auto-resolve

      const result = await resolveAgentExecutable({
        providerId: 'claude',
        cfg: { installSource: 'path', path: '/nonexistent/claude' },
        binaryName: 'claude',
        ctx,
      });
      expect(result).toBe('/opt/homebrew/bin/claude');
    });

    it('falls through to cachedStatePath when stored path is invalid', async () => {
      resolveCommandPathMock.mockResolvedValue(null);

      const result = await resolveAgentExecutable({
        providerId: 'claude',
        cfg: { installSource: 'path', path: '/nonexistent/claude' },
        binaryName: 'claude',
        ctx,
        cachedStatePath: '/cached/path/claude',
      });
      expect(result).toBe('/cached/path/claude');
    });
  });

  describe('installSource = cli', () => {
    it('returns cfg.cli as-is without probing', async () => {
      const result = await resolveAgentExecutable({
        providerId: 'claude',
        cfg: { installSource: 'cli', cli: 'my-claude' },
        binaryName: 'claude',
        ctx,
      });
      expect(result).toBe('my-claude');
      expect(resolveCommandPathMock).not.toHaveBeenCalled();
    });

    it('falls through to auto when cli is absent', async () => {
      resolveCommandPathMock.mockResolvedValue('/usr/bin/claude');
      const result = await resolveAgentExecutable({
        providerId: 'claude',
        cfg: { installSource: 'cli', cli: undefined },
        binaryName: 'claude',
        ctx,
      });
      expect(result).toBe('/usr/bin/claude');
    });
  });

  describe('auto resolution', () => {
    it('returns cachedStatePath when present', async () => {
      const result = await resolveAgentExecutable({
        providerId: 'claude',
        cfg: undefined,
        binaryName: 'claude',
        ctx,
        cachedStatePath: '/cached/claude',
      });
      expect(result).toBe('/cached/claude');
      expect(resolveCommandPathMock).not.toHaveBeenCalled();
    });

    it('resolves via ctx when no cache', async () => {
      resolveCommandPathMock.mockResolvedValue('/resolved/claude');
      const result = await resolveAgentExecutable({
        providerId: 'claude',
        cfg: undefined,
        binaryName: 'claude',
        ctx,
      });
      expect(result).toBe('/resolved/claude');
    });

    it('falls back to binaryName when ctx resolution fails', async () => {
      resolveCommandPathMock.mockResolvedValue(null);
      const result = await resolveAgentExecutable({
        providerId: 'claude',
        cfg: undefined,
        binaryName: 'claude',
        ctx,
      });
      expect(result).toBe('claude');
    });

    it('falls back to providerId when binaryName is empty and ctx fails', async () => {
      resolveCommandPathMock.mockResolvedValue(null);
      const result = await resolveAgentExecutable({
        providerId: 'claude',
        cfg: undefined,
        binaryName: '',
        ctx,
      });
      expect(result).toBe('claude');
    });

    it('caches the resolved path for subsequent calls', async () => {
      resolveCommandPathMock.mockResolvedValue('/cached/codex');
      await resolveAgentExecutable({
        providerId: 'codex',
        cfg: undefined,
        binaryName: 'codex',
        ctx,
      });
      resolveCommandPathMock.mockResolvedValue('/new/codex');
      const second = await resolveAgentExecutable({
        providerId: 'codex',
        cfg: undefined,
        binaryName: 'codex',
        ctx,
      });
      // Should return the cached value, not the new one
      expect(second).toBe('/cached/codex');
      expect(resolveCommandPathMock).toHaveBeenCalledTimes(1);
    });

    it('re-resolves after clearResolvedPathCache', async () => {
      resolveCommandPathMock.mockResolvedValue('/v1/claude');
      await resolveAgentExecutable({
        providerId: 'claude',
        cfg: undefined,
        binaryName: 'claude',
        ctx,
      });
      clearResolvedPathCache('claude');
      resolveCommandPathMock.mockResolvedValue('/v2/claude');
      const second = await resolveAgentExecutable({
        providerId: 'claude',
        cfg: undefined,
        binaryName: 'claude',
        ctx,
      });
      expect(second).toBe('/v2/claude');
    });
  });
});
