import type { DependencyStatusUpdatedEvent, DependencyId } from '@emdash/shared/deps/runtime';
import type { HostDependencyManager } from '@emdash/shared/deps/runtime/node';
import { Emitter } from '@emdash/shared/lib';
import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock the registry
vi.mock('./registry', () => ({
  getDependencyDescriptor: vi.fn(),
}));

// Mock the events module
vi.mock('@main/lib/events', () => ({
  events: { emit: vi.fn() },
}));

// Mock agent-payload-builder
vi.mock('../agents/agent-payload-builder', () => ({
  toAgentInstallationStatus: vi.fn(() => ({ id: 'mock' })),
}));

import { events } from '@main/lib/events';
import { AgentUpdateService } from './agent-update-service';
import { getDependencyDescriptor } from './registry';

function makeManager(): {
  manager: Pick<HostDependencyManager, 'onStatusUpdated' | 'onExecutableInvalidated'>;
  emitStatus: (event: DependencyStatusUpdatedEvent) => void;
} {
  const onStatusUpdated = new Emitter<DependencyStatusUpdatedEvent>();
  const onExecutableInvalidated = new Emitter<{ id: DependencyId }>();
  return {
    manager: { onStatusUpdated, onExecutableInvalidated } as unknown as HostDependencyManager,
    emitStatus: (event) => onStatusUpdated.emit(event),
  };
}

const npmDescriptor = {
  id: 'codex',
  updates: {
    kind: 'supported' as const,
    releaseSource: { kind: 'npm' as const, package: '@openai/codex' },
    update: { kind: 'package-manager' as const },
  },
  updateHooks: undefined,
};

const baseEvent: DependencyStatusUpdatedEvent = {
  id: 'codex' as DependencyId,
  state: {
    id: 'codex' as DependencyId,
    category: 'agent',
    status: 'available',
    version: '1.0.0',
    path: '/usr/bin/codex',
    checkedAt: 1000,
  },
  connectionId: undefined,
  hostDependency: undefined,
};

describe('AgentUpdateService', () => {
  beforeEach(() => {
    vi.mocked(getDependencyDescriptor).mockReset();
    vi.mocked(events.emit).mockReset();
  });

  it('emits enriched event with null latest version when dep has no descriptor', () => {
    vi.mocked(getDependencyDescriptor).mockReturnValue(undefined);

    const service = new AgentUpdateService();
    const { manager, emitStatus } = makeManager();
    service.attach(manager as unknown as HostDependencyManager, undefined);

    emitStatus(baseEvent);

    expect(events.emit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        state: expect.objectContaining({ latestVersion: null, updateAvailable: false }),
      })
    );
  });

  it('computes updateAvailable=false when cache is empty (emits immediately with null, then re-emits)', async () => {
    vi.mocked(getDependencyDescriptor).mockReturnValue(npmDescriptor as never);

    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ version: '2.0.0' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const service = new AgentUpdateService();
    const { manager, emitStatus } = makeManager();
    service.attach(manager as unknown as HostDependencyManager, undefined);

    emitStatus(baseEvent);

    // First emit is immediate with null latest
    expect(events.emit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        state: expect.objectContaining({ latestVersion: null, updateAvailable: false }),
      })
    );

    // Wait for async fetch to complete
    await new Promise((r) => setTimeout(r, 10));

    // Second emit should have enriched version info
    expect(events.emit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        state: expect.objectContaining({ latestVersion: '2.0.0', updateAvailable: true }),
      })
    );

    vi.unstubAllGlobals();
  });

  it('getUpdateInfo returns null/false before any fetch', () => {
    const service = new AgentUpdateService();

    const info = service.getUpdateInfo('codex' as DependencyId, '1.0.0');
    expect(info).toEqual({ latestVersion: null, updateAvailable: false });
  });

  it('getUpdateInfo returns cached result after fetch', async () => {
    vi.mocked(getDependencyDescriptor).mockReturnValue(npmDescriptor as never);

    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ version: '3.0.0' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const service = new AgentUpdateService();
    const { manager, emitStatus } = makeManager();
    service.attach(manager as unknown as HostDependencyManager, undefined);

    emitStatus(baseEvent);
    await new Promise((r) => setTimeout(r, 10));

    const info = service.getUpdateInfo('codex' as DependencyId, '1.0.0');
    expect(info.latestVersion).toBe('3.0.0');
    expect(info.updateAvailable).toBe(true);

    vi.unstubAllGlobals();
  });

  it('enriches hostDependency installations with latestVersion and updateAvailable', async () => {
    vi.mocked(getDependencyDescriptor).mockReturnValue(npmDescriptor as never);

    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ version: '2.0.0' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const service = new AgentUpdateService();
    const { manager, emitStatus } = makeManager();
    service.attach(manager as unknown as HostDependencyManager, undefined);

    const eventWithHostDep: DependencyStatusUpdatedEvent = {
      ...baseEvent,
      hostDependency: {
        hostId: 'local',
        dependencyId: 'codex' as DependencyId,
        usedId: 'method:npm',
        installations: [
          {
            id: 'method:npm',
            source: { kind: 'method', method: 'npm' },
            status: 'available',
            path: '/usr/bin/codex',
            version: '1.0.0',
            latestVersion: null,
            updateAvailable: false,
          },
        ],
      },
    };

    emitStatus(eventWithHostDep);
    await new Promise((r) => setTimeout(r, 10));

    // Find the last emit call with a hostDependency (the enriched one after async fetch)
    type EmitArgs = Parameters<typeof events.emit>;
    type HostDepPayload = {
      hostDependency: {
        installations: Array<{ updateAvailable: boolean; latestVersion: string | null }>;
      };
    };
    const calls = vi.mocked(events.emit).mock.calls as EmitArgs[];
    // Filter all calls that carry a hostDependency and take the last one (post-fetch)
    const hostDepCalls = calls.filter((args) => {
      const payload = args[1];
      return (
        typeof payload === 'object' &&
        payload !== null &&
        'hostDependency' in payload &&
        Boolean((payload as { hostDependency?: unknown }).hostDependency)
      );
    });
    const enrichedCall = hostDepCalls.at(-1);

    expect(enrichedCall).toBeDefined();
    const dep = (enrichedCall![1] as HostDepPayload).hostDependency;
    expect(dep.installations[0]?.latestVersion).toBe('2.0.0');
    expect(dep.installations[0]?.updateAvailable).toBe(true);

    vi.unstubAllGlobals();
  });

  it('enrichHostDependency: unknown+package-manager => updateAvailable=false', async () => {
    const pmDescriptor = {
      id: 'amp',
      updates: {
        kind: 'supported' as const,
        releaseSource: { kind: 'npm' as const, package: '@sourcegraph/amp' },
        update: { kind: 'package-manager' as const },
      },
      updateHooks: undefined,
    };
    vi.mocked(getDependencyDescriptor).mockReturnValue(pmDescriptor as never);

    const service = new AgentUpdateService();

    // Manually prime the cache so we can call enrichHostDependency synchronously
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any).latestVersionCache.set('amp', '2.0.0');

    const hostDep = {
      hostId: 'local',
      dependencyId: 'amp' as DependencyId,
      usedId: 'auto',
      installations: [
        {
          id: 'auto',
          source: { kind: 'unknown' as const },
          status: 'available' as const,
          path: '/opt/shims/amp',
          version: '1.0.0',
          latestVersion: null,
          updateAvailable: false,
        },
      ],
    };

    const enriched = service.enrichHostDependency('amp' as DependencyId, hostDep);
    expect(enriched.installations[0]?.latestVersion).toBe('2.0.0');
    expect(enriched.installations[0]?.updateAvailable).toBe(false);
  });

  it('enrichHostDependency: unknown+cli => updateAvailable=true', async () => {
    const cliDescriptor = {
      id: 'claude',
      updates: {
        kind: 'supported' as const,
        releaseSource: { kind: 'github' as const, repo: 'anthropics/claude-code' },
        update: { kind: 'cli' as const, args: ['update'] },
      },
      updateHooks: undefined,
    };
    vi.mocked(getDependencyDescriptor).mockReturnValue(cliDescriptor as never);

    const service = new AgentUpdateService();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any).latestVersionCache.set('claude', '2.0.0');

    const hostDep = {
      hostId: 'local',
      dependencyId: 'claude' as DependencyId,
      usedId: 'auto',
      installations: [
        {
          id: 'auto',
          source: { kind: 'unknown' as const },
          status: 'available' as const,
          path: '/opt/shims/claude',
          version: '1.0.0',
          latestVersion: null,
          updateAvailable: false,
        },
      ],
    };

    const enriched = service.enrichHostDependency('claude' as DependencyId, hostDep);
    expect(enriched.installations[0]?.latestVersion).toBe('2.0.0');
    expect(enriched.installations[0]?.updateAvailable).toBe(true);
  });

  it('refreshLatestVersion invalidates cache and re-emits', async () => {
    vi.mocked(getDependencyDescriptor).mockReturnValue(npmDescriptor as never);

    let callCount = 0;
    const fetchMock = vi.fn().mockImplementation(async () => {
      callCount++;
      return new Response(JSON.stringify({ version: callCount === 1 ? '1.5.0' : '2.0.0' }), {
        status: 200,
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const service = new AgentUpdateService();
    const { manager, emitStatus } = makeManager();
    service.attach(manager as unknown as HostDependencyManager, undefined);

    emitStatus(baseEvent);
    await new Promise((r) => setTimeout(r, 10));

    const infoBefore = service.getUpdateInfo('codex' as DependencyId, '1.0.0');
    expect(infoBefore.latestVersion).toBe('1.5.0');

    await service.refreshLatestVersion('codex' as DependencyId, undefined);

    const infoAfter = service.getUpdateInfo('codex' as DependencyId, '1.0.0');
    expect(infoAfter.latestVersion).toBe('2.0.0');
    expect(fetchMock).toHaveBeenCalledTimes(2);

    vi.unstubAllGlobals();
  });
});
