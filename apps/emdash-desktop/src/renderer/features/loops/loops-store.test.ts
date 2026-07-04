import { ok, type Result } from '@emdash/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loopPhaseUpdatedChannel, loopUpdatedChannel } from '@shared/core/loops/loopEvents';
import type { Loop, LoopPhase, LoopWithPhases } from '@shared/core/loops/loops';
import { LoopsStore, type LoopsEventClient, type LoopsRpcClient } from './loops-store';

const ipcMocks = vi.hoisted(() => ({
  eventsOn: vi.fn(() => () => {}),
  loopsRpc: {
    createLoop: vi.fn(),
    getLoopsForProject: vi.fn(),
    getLoop: vi.fn(),
    getVerifierAvailability: vi.fn(),
    startLoop: vi.fn(),
    pauseLoop: vi.fn(),
    resumeLoop: vi.fn(),
    cancelLoop: vi.fn(),
    retryPhase: vi.fn(),
    deleteLoop: vi.fn(),
  },
}));

vi.mock('@renderer/lib/ipc', () => ({
  events: { on: ipcMocks.eventsOn },
  rpc: { loops: ipcMocks.loopsRpc },
}));

type EventDefinition<TData> = {
  name: string;
  _data?: TData;
};

function createEventClient(): {
  client: LoopsEventClient;
  emit<TData>(event: EventDefinition<TData>, data: TData): void;
} {
  const handlers = new Map<string, Set<(data: unknown) => void>>();
  return {
    client: {
      on: (event, cb) => {
        const set = handlers.get(event.name) ?? new Set<(data: unknown) => void>();
        set.add(cb as (data: unknown) => void);
        handlers.set(event.name, set);
        return () => set.delete(cb as (data: unknown) => void);
      },
    },
    emit: (event, data) => {
      for (const handler of handlers.get(event.name) ?? []) {
        handler(data);
      }
    },
  };
}

function makeLoop(patch: Partial<LoopWithPhases> = {}): LoopWithPhases {
  return {
    id: 'loop-1',
    projectId: 'project-1',
    taskId: 'task-1',
    name: 'Loop one',
    slug: 'loop-one',
    status: 'draft',
    currentPhaseIndex: 0,
    config: null,
    phases: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...patch,
  };
}

function makePhase(patch: Partial<LoopPhase> = {}): LoopPhase {
  return {
    id: 'phase-1',
    loopId: 'loop-1',
    idx: 0,
    name: 'Phase one',
    goal: 'Ship phase one',
    status: 'pending',
    attempts: 0,
    conversationId: null,
    criteria: null,
    lastError: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...patch,
  };
}

function rpcWith(overrides: Partial<LoopsRpcClient>): LoopsRpcClient {
  const fallback = async <T>(): Promise<Result<T, unknown>> => ok(undefined as T);
  return {
    createLoop: fallback,
    getLoopsForProject: async () => ok([]),
    getLoop: async () => ok(makeLoop()),
    getVerifierAvailability: async () => ok([]),
    startLoop: async (loopId) => ok(makeLoop({ id: loopId, status: 'running' })),
    pauseLoop: async (loopId) => ok(makeLoop({ id: loopId, status: 'paused' })),
    resumeLoop: async (loopId) => ok(makeLoop({ id: loopId, status: 'running' })),
    cancelLoop: async (loopId) => ok(makeLoop({ id: loopId, status: 'failed' })),
    retryPhase: async (loopId) => ok(makeLoop({ id: loopId, status: 'paused' })),
    deleteLoop: async () => ok(undefined),
    ...overrides,
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('LoopsStore', () => {
  it('loads project loops from RPC and sorts phases by index', async () => {
    const events = createEventClient();
    const loop = makeLoop({
      phases: [makePhase({ id: 'phase-2', idx: 1 }), makePhase({ id: 'phase-1', idx: 0 })],
    });
    const rpc = rpcWith({
      getLoopsForProject: vi.fn(async () => ok([loop])),
    });
    const store = new LoopsStore({ rpcClient: rpc, eventClient: events.client });

    await store.loadProject('project-1');

    expect(rpc.getLoopsForProject).toHaveBeenCalledWith('project-1');
    expect(store.getProjectLoadState('project-1').kind).toBe('ready');
    expect(store.getLoopsForProject('project-1').map((item) => item.id)).toEqual(['loop-1']);
    expect(store.getLoop('loop-1')?.phases.map((phase) => phase.idx)).toEqual([0, 1]);

    store.dispose();
  });

  it('merges loop and phase update events into loaded project state', async () => {
    const events = createEventClient();
    const store = new LoopsStore({
      rpcClient: rpcWith({ getLoopsForProject: async () => ok([]) }),
      eventClient: events.client,
    });

    await store.loadProject('project-1');

    const loop: Loop = makeLoop({ status: 'running' });
    events.emit(loopUpdatedChannel, { loop });
    events.emit(loopPhaseUpdatedChannel, {
      loopId: loop.id,
      phase: makePhase({ status: 'verifying', attempts: 2 }),
    });

    expect(store.getLoopsForProject('project-1').map((item) => item.id)).toEqual(['loop-1']);
    expect(store.getLoop('loop-1')?.status).toBe('running');
    expect(store.getLoop('loop-1')?.phases[0]?.status).toBe('verifying');
    expect(store.getLoop('loop-1')?.phases[0]?.attempts).toBe(2);

    store.dispose();
  });

  it('applies action RPC responses back into the cached loop', async () => {
    const events = createEventClient();
    const rpc = rpcWith({
      getLoopsForProject: async () => ok([makeLoop()]),
      startLoop: vi.fn(async (loopId) => ok(makeLoop({ id: loopId, status: 'running' }))),
    });
    const store = new LoopsStore({ rpcClient: rpc, eventClient: events.client });

    await store.loadProject('project-1');
    await store.startLoop('loop-1');

    expect(rpc.startLoop).toHaveBeenCalledWith('loop-1');
    expect(store.getLoop('loop-1')?.status).toBe('running');
    expect(store.isActionPending('loop-1')).toBe(false);

    store.dispose();
  });
});
