import { createScope, type Scope } from '@emdash/shared/concurrency';
import { deferred } from '@emdash/shared/testing';
import { describe, expect, it, vi } from 'vitest';
import { makeAcpHarness, makeStartInput } from '#runtimes/acp/node/acp-test-support';
import type { AcpConnectionEntry, AcpConnectionSource } from '#runtimes/acp/node/connection/source';
import type { ConversationHandle } from './conversation-handle';
import type { ConfigOverrides, SessionRecord } from './conversation-types';
import { SessionMaterializer, type SessionMaterializerCallbacks } from './session-materializer';

describe('SessionMaterializer', () => {
  it('falls back to a fresh session and reapplies retained config overrides', async () => {
    const h = makeAcpHarness();
    h.agent.loadSession.mockRejectedValueOnce(new Error('session file is gone'));
    h.agent.newSession.mockResolvedValueOnce({
      sessionId: 'replacement',
      configOptions: [effortConfigOption('low'), collaborationModeConfigOption('default')],
    });
    const setup = materializerHarness(h, { effort: 'high', collaborationMode: 'plan' });

    const result = await setup.materializer.materialize(
      setup.entry,
      setup.entry.descriptor,
      1,
      setup.scope,
      setup.controller.signal
    );

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.record.cell.acpSessionId).toBe('replacement');
    expect(result.data.record.resumeOutcome).toBe('replaced-by-new');
    expect(h.agent.loadSession).toHaveBeenCalledTimes(1);
    expect(h.agent.newSession).toHaveBeenCalledTimes(1);
    expect(h.agent.setSessionConfigOption).toHaveBeenCalledWith({
      sessionId: 'replacement',
      configId: 'reasoning_effort',
      value: 'high',
    });
    expect(h.agent.setSessionConfigOption).toHaveBeenCalledWith({
      sessionId: 'replacement',
      configId: 'collaboration_mode',
      value: 'plan',
    });
    expect(setup.discarded).toHaveLength(1);

    await setup.scope.dispose();
    expect(setup.release).toHaveBeenCalledTimes(1);
  });

  it('loads an existing session without creating a replacement', async () => {
    const h = makeAcpHarness();
    h.agent.loadSession.mockResolvedValueOnce({});
    const setup = materializerHarness(h);

    const result = await setup.materializer.materialize(
      setup.entry,
      setup.entry.descriptor,
      1,
      setup.scope,
      setup.controller.signal
    );

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.record.cell.acpSessionId).toBe('retained-session');
    expect(result.data.record.resumeOutcome).toBe('loaded');
    expect(h.agent.newSession).not.toHaveBeenCalled();
    expect(setup.loading).toEqual([]);
    expect(setup.routes).toContainEqual({
      processOwner: 'claude:/tmp/workspace:1',
      sessionId: 'retained-session',
      conversationId: 'conv-materializer',
    });

    await setup.scope.dispose();
  });

  it('rejects a late completion after the caller aborts and invalidates the conversation', async () => {
    const h = makeAcpHarness();
    h.agent.newSession = vi.fn(() => new Promise<never>(() => {}));
    const setup = materializerHarness(h, {}, { sessionId: null });

    const pending = setup.materializer.materialize(
      setup.entry,
      setup.entry.descriptor,
      1,
      setup.scope,
      setup.controller.signal
    );
    await vi.waitFor(() => expect(h.agent.newSession).toHaveBeenCalledTimes(1));
    setup.current.value = false;
    setup.controller.abort(new Error('conversation killed'));

    await expect(pending).resolves.toMatchObject({
      success: false,
      error: { type: 'conversation_not_found' },
    });
    await setup.scope.dispose();
  });

  it('serializes provider load handshakes on one process generation', async () => {
    const h = makeAcpHarness();
    const firstLoad = deferred<Record<string, never>>();
    const secondLoad = deferred<Record<string, never>>();
    h.agent.loadSession
      .mockImplementationOnce(async () => firstLoad.promise)
      .mockImplementationOnce(async () => secondLoad.promise);
    const setup = materializerHarness(h);
    const secondInput = makeStartInput({
      conversationId: 'conv-materializer-2',
      sessionId: 'retained-session-2',
    });
    const secondEntry = {
      conversationId: secondInput.conversationId,
      descriptor: secondInput,
      configOverrides: {},
    } as ConversationHandle;

    const first = setup.materializer.materialize(
      setup.entry,
      setup.entry.descriptor,
      1,
      setup.scope,
      setup.controller.signal
    );
    await vi.waitFor(() => expect(h.agent.loadSession).toHaveBeenCalledTimes(1));
    const second = setup.materializer.materialize(
      secondEntry,
      secondEntry.descriptor,
      1,
      setup.scope,
      setup.controller.signal
    );
    await Promise.resolve();

    expect(h.agent.loadSession).toHaveBeenCalledTimes(1);
    expect(setup.loading).toEqual(['conv-materializer']);
    firstLoad.resolve({});
    await first;
    await vi.waitFor(() => expect(h.agent.loadSession).toHaveBeenCalledTimes(2));
    expect(setup.loading).toEqual(['conv-materializer-2']);
    secondLoad.resolve({});
    await second;
    await setup.scope.dispose();
  });

  it('does not serialize new-session requests that need no provisional routing', async () => {
    const h = makeAcpHarness();
    const firstNew = deferred<{ sessionId: string }>();
    const secondNew = deferred<{ sessionId: string }>();
    h.agent.newSession
      .mockImplementationOnce(async () => firstNew.promise)
      .mockImplementationOnce(async () => secondNew.promise);
    const setup = materializerHarness(h, {}, { sessionId: null });
    const secondInput = makeStartInput({
      conversationId: 'conv-materializer-2',
      sessionId: null,
    });
    const secondEntry = {
      conversationId: secondInput.conversationId,
      descriptor: secondInput,
      configOverrides: {},
    } as ConversationHandle;

    const first = setup.materializer.materialize(
      setup.entry,
      setup.entry.descriptor,
      1,
      setup.scope,
      setup.controller.signal
    );
    const second = setup.materializer.materialize(
      secondEntry,
      secondEntry.descriptor,
      1,
      setup.scope,
      setup.controller.signal
    );

    await vi.waitFor(() => expect(h.agent.newSession).toHaveBeenCalledTimes(2));
    firstNew.resolve({ sessionId: 'new-session-1' });
    secondNew.resolve({ sessionId: 'new-session-2' });
    await Promise.all([first, second]);
    await setup.scope.dispose();
  });
});

function materializerHarness(
  harness: ReturnType<typeof makeAcpHarness>,
  configOverrides: ConfigOverrides = {},
  inputOverrides: Parameters<typeof makeStartInput>[0] = {}
) {
  const input = makeStartInput({
    conversationId: 'conv-materializer',
    sessionId: 'retained-session',
    ...inputOverrides,
  });
  const entry = {
    conversationId: input.conversationId,
    descriptor: input,
    configOverrides,
  } as ConversationHandle;
  const connection: AcpConnectionEntry = {
    key: 'claude:/tmp/workspace',
    generation: 1,
    providerId: 'claude',
    cwd: '/tmp/workspace',
    normalize: (update) => update as never,
    agent: harness.agent,
    supportsLoadSession: true,
    mcpCapabilities: { http: false, sse: false },
  };
  const release = vi.fn(async () => {});
  const connections: AcpConnectionSource = {
    acquire: vi.fn(() => ({ ready: async () => connection, release })),
    peek: () => connection,
    invalidate: async () => {},
    dispose: async () => {},
  };
  const scope = createScope({ label: 'session-materializer-test' });
  const controller = new AbortController();
  const current = { value: true };
  const discarded: SessionRecord[] = [];
  const loading: string[] = [];
  const routes: Array<{
    processOwner: string;
    sessionId: string;
    conversationId: string;
  }> = [];
  const callbacks: SessionMaterializerCallbacks = {
    isCurrent: () => current.value,
    onRecordCreated: (record, recordScope) => ownRecord(record, recordScope),
    onRecordChanged: () => {},
    onRecordClosed: () => {},
    discardRecord: (record) => {
      discarded.push(record);
      record.cell.dispose();
    },
    registerRoute: (processOwner, sessionId, conversationId) => {
      routes.push({ processOwner, sessionId, conversationId });
    },
    beginLoad: (processOwner, sessionId, conversationId) => {
      routes.push({ processOwner, sessionId, conversationId });
      loading.push(conversationId);
      return () => {
        const index = loading.indexOf(conversationId);
        if (index >= 0) loading.splice(index, 1);
      };
    },
  };
  const materializer = new SessionMaterializer(
    {
      agentHost: harness.deps.agentHost,
      resolveAttachment: harness.deps.resolveAttachment,
      logger: harness.deps.logger,
    },
    connections,
    callbacks
  );

  return {
    materializer,
    entry,
    scope,
    controller,
    current,
    discarded,
    loading,
    routes,
    release,
  };
}

function ownRecord(record: SessionRecord, scope: Scope): void {
  scope.add(() => {
    record.machineStateBinding.dispose();
    record.cell.dispose();
  });
}

function effortConfigOption(currentValue: string) {
  return {
    id: 'reasoning_effort',
    name: 'Reasoning effort',
    category: 'thought_level',
    type: 'select',
    currentValue,
    options: [
      { value: 'low', name: 'Low' },
      { value: 'high', name: 'High' },
    ],
  };
}

function collaborationModeConfigOption(currentValue: string) {
  return {
    id: 'collaboration_mode',
    name: 'Collaboration mode',
    category: 'collaboration_mode',
    type: 'select',
    currentValue,
    options: [
      { value: 'default', name: 'Default' },
      { value: 'plan', name: 'Plan' },
    ],
  };
}
