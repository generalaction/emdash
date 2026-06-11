import type { HostDependencySelection } from '@emdash/shared/deps';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IHostDependencyStore } from '@main/core/dependencies/host-dependency-store';

const resolveCommandPathMock = vi.hoisted(() =>
  vi.fn<() => Promise<string | null>>().mockResolvedValue(null)
);

vi.mock('@emdash/shared/deps/runtime', () => ({
  resolveCommandPath: resolveCommandPathMock,
}));

vi.mock('@main/lib/logger', () => ({
  log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const { resolveAgentExecutable, clearResolvedPathCache } =
  await import('./resolve-agent-executable');

const ctx = {} as never;

function makeStore(selection: HostDependencySelection | null = null): IHostDependencyStore {
  return {
    getSelection: vi.fn().mockResolvedValue(selection),
    setSelection: vi.fn().mockResolvedValue(undefined),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  clearResolvedPathCache('claude');
  clearResolvedPathCache('codex');
  clearResolvedPathCache('unknown');
});

describe('resolveAgentExecutable', () => {
  describe('usedId = path', () => {
    it('returns the stored path when it exists on disk', async () => {
      resolveCommandPathMock.mockResolvedValue('/usr/local/bin/claude');
      const result = await resolveAgentExecutable({
        providerId: 'claude',
        binaryName: 'claude',
        ctx,
        hostDependencyStore: makeStore({ usedId: 'path', path: '/usr/local/bin/claude' }),
      });
      expect(result).toBe('/usr/local/bin/claude');
      expect(resolveCommandPathMock).toHaveBeenCalledWith('/usr/local/bin/claude', ctx);
    });

    it('falls through to auto-resolution when stored path does not exist', async () => {
      resolveCommandPathMock
        .mockResolvedValueOnce(null) // path check
        .mockResolvedValueOnce('/opt/homebrew/bin/claude'); // auto-resolve

      const result = await resolveAgentExecutable({
        providerId: 'claude',
        binaryName: 'claude',
        ctx,
        hostDependencyStore: makeStore({ usedId: 'path', path: '/nonexistent/claude' }),
      });
      expect(result).toBe('/opt/homebrew/bin/claude');
    });

    it('falls through to cachedStatePath when stored path is invalid', async () => {
      resolveCommandPathMock.mockResolvedValue(null);

      const result = await resolveAgentExecutable({
        providerId: 'claude',
        binaryName: 'claude',
        ctx,
        hostDependencyStore: makeStore({ usedId: 'path', path: '/nonexistent/claude' }),
        cachedStatePath: '/cached/path/claude',
      });
      expect(result).toBe('/cached/path/claude');
    });
  });

  describe('usedId = cli', () => {
    it('returns the stored CLI command without probing', async () => {
      const result = await resolveAgentExecutable({
        providerId: 'claude',
        binaryName: 'claude',
        ctx,
        hostDependencyStore: makeStore({ usedId: 'cli', cli: 'my-claude' }),
      });
      expect(result).toBe('my-claude');
      expect(resolveCommandPathMock).not.toHaveBeenCalled();
    });

    it('falls through to auto when cli is absent even if usedId is cli', async () => {
      resolveCommandPathMock.mockResolvedValue('/usr/bin/claude');
      const result = await resolveAgentExecutable({
        providerId: 'claude',
        binaryName: 'claude',
        ctx,
        hostDependencyStore: makeStore({ usedId: 'cli', cli: undefined }),
      });
      expect(result).toBe('/usr/bin/claude');
    });
  });

  describe('auto resolution', () => {
    it('returns cachedStatePath when present and no selection', async () => {
      const result = await resolveAgentExecutable({
        providerId: 'claude',
        binaryName: 'claude',
        ctx,
        hostDependencyStore: makeStore(null),
        cachedStatePath: '/cached/claude',
      });
      expect(result).toBe('/cached/claude');
      expect(resolveCommandPathMock).not.toHaveBeenCalled();
    });

    it('resolves via ctx when no cache', async () => {
      resolveCommandPathMock.mockResolvedValue('/resolved/claude');
      const result = await resolveAgentExecutable({
        providerId: 'claude',
        binaryName: 'claude',
        ctx,
        hostDependencyStore: makeStore(null),
      });
      expect(result).toBe('/resolved/claude');
    });

    it('falls back to binaryName when ctx resolution fails', async () => {
      resolveCommandPathMock.mockResolvedValue(null);
      const result = await resolveAgentExecutable({
        providerId: 'claude',
        binaryName: 'claude',
        ctx,
        hostDependencyStore: makeStore(null),
      });
      expect(result).toBe('claude');
    });

    it('falls back to providerId when binaryName is empty and ctx fails', async () => {
      resolveCommandPathMock.mockResolvedValue(null);
      const result = await resolveAgentExecutable({
        providerId: 'claude',
        binaryName: '',
        ctx,
        hostDependencyStore: makeStore(null),
      });
      expect(result).toBe('claude');
    });

    it('caches the resolved path for subsequent calls', async () => {
      resolveCommandPathMock.mockResolvedValue('/cached/codex');
      await resolveAgentExecutable({
        providerId: 'codex',
        binaryName: 'codex',
        ctx,
        hostDependencyStore: makeStore(null),
      });
      resolveCommandPathMock.mockResolvedValue('/new/codex');
      const second = await resolveAgentExecutable({
        providerId: 'codex',
        binaryName: 'codex',
        ctx,
        hostDependencyStore: makeStore(null),
      });
      expect(second).toBe('/cached/codex');
      expect(resolveCommandPathMock).toHaveBeenCalledTimes(1);
    });

    it('re-resolves after clearResolvedPathCache', async () => {
      resolveCommandPathMock.mockResolvedValue('/v1/claude');
      await resolveAgentExecutable({
        providerId: 'claude',
        binaryName: 'claude',
        ctx,
        hostDependencyStore: makeStore(null),
      });
      clearResolvedPathCache('claude');
      resolveCommandPathMock.mockResolvedValue('/v2/claude');
      const second = await resolveAgentExecutable({
        providerId: 'claude',
        binaryName: 'claude',
        ctx,
        hostDependencyStore: makeStore(null),
      });
      expect(second).toBe('/v2/claude');
    });
  });
});
