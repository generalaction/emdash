import { systemClock } from '@emdash/shared/scheduling';
import { cell, peek } from '@emdash/wire/state';
import { describe, expect, it, vi } from 'vitest';
import { acpErr, initialSessionConfigState, type SessionConfigState } from '#runtimes/acp/api';
import { makeStartInput } from '#runtimes/acp/node/acp-test-support';
import type { SessionConfigCatalog } from '#runtimes/acp/node/session/cell';
import {
  closedSessionState,
  type SessionLiveModels,
  type SessionsListModel,
} from '#runtimes/acp/node/state/live-models';
import {
  ConversationHandle,
  type ConversationHandleDeps,
  type ConversationHandleState,
} from './conversation-handle';
import type { SessionRecord } from './conversation-types';
import { SessionsListProjector } from './sessions-list-projector';

describe('ConversationHandle', () => {
  it('invalidates provisional records from superseded materialization epochs', () => {
    const setup = makeHandle();
    const first = setup.handle.beginMaterialization();
    const second = setup.handle.beginMaterialization();
    if (!first || !second) throw new Error('expected materialization epochs');
    const stale = makeRecord(setup.handle, first.epoch);
    const current = makeRecord(setup.handle, second.epoch);

    setup.handle.attachProvisional(stale);
    expect(setup.handle.currentRecord()).toBeUndefined();

    setup.handle.attachProvisional(current);
    setup.handle.activate(current);

    expect(first.signal.aborted).toBe(true);
    expect(setup.handle.state).toBe('active');
    expect(setup.handle.readyRecord()).toBe(current);
    expect(peek(setup.projection.source).kind).toBe('active');
  });

  for (const initialState of [
    'closed',
    'suspended',
    'materializing',
    'active',
    'stopping',
  ] as const satisfies readonly ConversationHandleState[]) {
    it(`kills from ${initialState} and releases its projection exactly once`, () => {
      const setup = makeHandle();
      moveTo(setup.handle, initialState);

      setup.handle.kill();
      setup.handle.kill();

      expect(setup.handle.state).toBe('killed');
      expect(setup.handle.currentRecord()).toBeUndefined();
      expect(peek(setup.projection.source)).toEqual({ kind: 'closed' });
      expect(setup.releaseProjection).toHaveBeenCalledTimes(1);
      expect(peek(setup.listModel.states.list)[setup.handle.conversationId]).toBeUndefined();
    });
  }

  it('writes descriptor and config changes through one persistence seam', () => {
    const setup = makeHandle({ everMaterialized: true });

    setup.handle.updateMode('plan');
    setup.handle.updateConfig('effort', 'high');
    setup.handle.updateProviderSessionId('session-2');

    expect(setup.saveIntent).toHaveBeenCalledTimes(3);
    expect(setup.handle.intentPayload()).toMatchObject({
      payload: {
        sessionId: 'session-2',
        configured: { modeId: 'plan', effort: 'high' },
      },
      sessionId: 'session-2',
    });
  });

  it('retains pending capabilities and atomically replaces them when the catalog is ready', () => {
    const setup = makeHandle();
    const firstMaterialization = setup.handle.beginMaterialization();
    if (!firstMaterialization) throw new Error('expected materialization epoch');
    const firstRecord = makeRecord(setup.handle, firstMaterialization.epoch);
    const firstCell = firstRecord.cell as unknown as {
      config: SessionConfigState;
      configCatalog: SessionConfigCatalog;
    };
    firstCell.config = {
      ...initialSessionConfigState,
      modelOptions: {
        configId: 'model',
        selected: 'opus',
        available: [
          { id: 'opus', name: 'Opus' },
          { id: 'haiku', name: 'Haiku' },
        ],
      },
      efforts: {
        configId: 'effort',
        selected: 'medium',
        available: [{ id: 'medium', name: 'Medium' }],
      },
    };
    firstCell.configCatalog = readyConfigCatalog(firstCell.config);
    setup.handle.attachProvisional(firstRecord);
    setup.handle.activate(firstRecord);

    const secondMaterialization = setup.handle.beginMaterialization();
    if (!secondMaterialization) throw new Error('expected rematerialization epoch');
    const record = makeRecord(setup.handle, secondMaterialization.epoch);
    const recordCell = record.cell as unknown as {
      config: SessionConfigState;
      configCatalog: SessionConfigCatalog;
    };
    setup.handle.attachProvisional(record);

    let source = peek(setup.projection.source);
    expect(source.kind).toBe('active');
    if (source.kind !== 'active') throw new Error('expected active projection');
    expect(source.snapshot.config.modelOptions?.selected).toBe('opus');
    expect(source.snapshot.config.efforts?.selected).toBe('medium');

    recordCell.config = {
      ...initialSessionConfigState,
      modelOptions: {
        configId: 'model',
        selected: 'haiku',
        available: [
          { id: 'opus', name: 'Opus' },
          { id: 'haiku', name: 'Haiku' },
        ],
      },
      efforts: null,
    };
    recordCell.configCatalog = readyConfigCatalog(recordCell.config);
    setup.handle.syncRecord(record);

    source = peek(setup.projection.source);
    expect(source.kind).toBe('active');
    if (source.kind !== 'active') throw new Error('expected active projection');
    expect(source.snapshot.config.modelOptions?.selected).toBe('haiku');
    expect(source.snapshot.config.efforts).toBeNull();

    setup.handle.activate(record);
    setup.handle.suspend();

    const suspended = peek(setup.projection.source);
    expect(suspended.kind).toBe('suspended');
    if (suspended.kind !== 'suspended') throw new Error('expected suspended projection');
    if (!suspended.retained) throw new Error('expected retained presentation');
    expect(suspended.retained.lastKnownCapabilities.modelOptions?.selected).toBe('haiku');
    expect(suspended.retained.lastKnownCapabilities.efforts).toBeNull();
  });

  it('persists an allowlisted versioned intent without provider environment secrets', () => {
    const setup = makeHandle({ everMaterialized: true });
    setup.handle.refreshDescriptor({
      ...setup.handle.descriptor,
      env: { API_TOKEN: 'must-not-be-persisted' },
      model: 'sonnet',
      modeId: 'agent',
      effort: 'high',
    });

    const intent = setup.handle.intentPayload();

    expect(intent).toMatchObject({
      payload: {
        version: '1',
        conversationId: 'conv-handle',
        providerId: 'claude',
        cwd: '/tmp/workspace',
        configured: { model: 'sonnet', modeId: 'agent', effort: 'high' },
      },
    });
    expect(JSON.stringify(intent)).not.toContain('API_TOKEN');
    expect(JSON.stringify(intent)).not.toContain('must-not-be-persisted');
  });

  it('aborts in-flight materialization before disposal waits for activation drain', async () => {
    let enteredMaterialization: () => void = () => {};
    const materializing = new Promise<void>((resolve) => {
      enteredMaterialization = resolve;
    });
    const setup = makeHandle({
      materialize: async () => {
        const attempt = setup.handle.beginMaterialization();
        if (!attempt) return acpErr.conversationNotFound(setup.handle.conversationId);
        enteredMaterialization();
        return await new Promise((resolve) => {
          attempt.signal.addEventListener(
            'abort',
            () => resolve(acpErr.conversationNotFound(setup.handle.conversationId)),
            { once: true }
          );
        });
      },
    });

    const activation = setup.handle.ensure();
    await materializing;

    await expect(setup.handle.dispose()).resolves.toBeUndefined();
    await expect(activation).rejects.toThrow('LifecycleRegistry disposed');
    expect(setup.handle.state).toBe('closed');
  });

  it('rejects commands after kill while directory removal is still pending', async () => {
    const setup = makeHandle();
    const materialization = setup.handle.beginMaterialization();
    if (!materialization) throw new Error('expected materialization epoch');
    const record = makeRecord(setup.handle, materialization.epoch);
    setup.handle.attachProvisional(record);
    setup.handle.activate(record);
    const operation = vi.fn(() => ({ success: true as const, data: undefined }));

    setup.handle.kill();

    await expect(setup.handle.use(operation)).resolves.toMatchObject({
      success: false,
      error: { type: 'conversation_not_found' },
    });
    expect(operation).not.toHaveBeenCalled();
    expect(setup.handle.beginMaterialization()).toBeNull();
  });
});

function makeHandle(
  options: {
    everMaterialized?: boolean;
    materialize?: ConversationHandleDeps['materialize'];
  } = {}
) {
  const source = cell({ kind: 'closed' } as const);
  const projection = { source, states: {} } as unknown as SessionLiveModels;
  const listModel: SessionsListModel = { states: { list: cell({}) } };
  const listProjector = new SessionsListProjector(listModel, systemClock, () => ({
    lastInputAt: null,
    lastOutputAt: null,
    attachedClients: 0,
    detachedAt: null,
  }));
  const releaseProjection = vi.fn();
  const saveIntent = vi.fn();
  const handle = new ConversationHandle(
    {
      projection,
      releaseProjection,
      listProjector,
      terminals: { listByConversation: () => [] },
      saveIntent,
      materialize:
        options.materialize ??
        (async () => {
          throw new Error('not used by this unit harness');
        }),
      interruptRecord: () => {},
      onActivated: () => {},
      activationDrainTimeoutMs: 100,
      onLeaseDrainTimeout: () => {},
      onActivationObserverError: () => {},
      now: () => 123,
    },
    makeStartInput({ conversationId: 'conv-handle' }),
    {},
    false,
    options.everMaterialized ?? false
  );
  return {
    handle,
    projection,
    listModel,
    releaseProjection,
    saveIntent,
  };
}

function moveTo(handle: ConversationHandle, state: ConversationHandleState): void {
  if (state === 'closed') return;
  if (state === 'suspended') {
    handle.initializeSuspended();
    return;
  }
  const materialization = handle.beginMaterialization();
  if (!materialization) throw new Error('expected materialization epoch');
  if (state === 'materializing') return;
  const record = makeRecord(handle, materialization.epoch);
  handle.attachProvisional(record);
  handle.activate(record);
  if (state === 'stopping') handle.beginStopping();
}

function makeRecord(handle: ConversationHandle, epoch: number): SessionRecord {
  const input = handle.materializationInput();
  return {
    conversation: handle,
    epoch,
    input,
    resumeOutcome: null,
    clearedConfiguration: [],
    processKey: 'claude:/tmp/workspace',
    processGeneration: 1,
    connectionLeaseState: { release: true },
    cell: {
      sessionState: { ...closedSessionState, lifecycle: 'ready', canSubmit: true },
      config: initialSessionConfigState,
      configCatalog: { kind: 'pending' },
      usage: null,
      transcript: { title: null, plan: null, agents: [], activeTurn: null },
    } as unknown as SessionRecord['cell'],
    mcpServers: [],
    machineStateBinding: { dispose: () => {} },
    disposed: false,
  };
}

function readyConfigCatalog(config: SessionConfigState): SessionConfigCatalog {
  const { modelOptions, efforts, modeOptions, collaborationModeOptions } = config;
  return {
    kind: 'ready',
    config: { modelOptions, efforts, modeOptions, collaborationModeOptions },
  };
}
