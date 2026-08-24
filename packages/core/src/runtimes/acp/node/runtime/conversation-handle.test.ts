import { systemClock } from '@emdash/shared/scheduling';
import { cell, peek } from '@emdash/wire/state';
import { describe, expect, it, vi } from 'vitest';
import { initialSessionConfigState } from '#runtimes/acp/api';
import { makeStartInput } from '#runtimes/acp/node/acp-test-support';
import {
  closedSessionState,
  type SessionLiveModels,
  type SessionsListModel,
} from '#runtimes/acp/node/state/live-models';
import { ConversationHandle, type ConversationHandleState } from './conversation-handle';
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
        modeId: 'plan',
        sessionId: 'session-2',
        configOverrides: { effort: 'high' },
      },
      sessionId: 'session-2',
    });
  });
});

function makeHandle(options: { everMaterialized?: boolean } = {}) {
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
  let owned = true;
  const handle = new ConversationHandle(
    {
      projection,
      releaseProjection,
      listProjector,
      isOwned: () => owned,
      saveIntent,
      buildSnapshot: () => ({
        state: { ...closedSessionState, lifecycle: 'ready', canSubmit: true },
        config: initialSessionConfigState,
        usage: null,
        plan: null,
        agents: [],
        activeTurn: null,
        terminals: [],
        mcpServers: [],
      }),
      onMaterializingRecord: () => {},
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
    relinquish: () => {
      owned = false;
    },
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
    processKey: 'claude:/tmp/workspace',
    processGeneration: 1,
    connectionLeaseState: { release: true },
    cell: {
      sessionState: { ...closedSessionState, lifecycle: 'ready', canSubmit: true },
      transcript: { title: null },
    } as SessionRecord['cell'],
    mcpServers: [],
    machineStateBinding: { dispose: () => {} },
    disposed: false,
  };
}
