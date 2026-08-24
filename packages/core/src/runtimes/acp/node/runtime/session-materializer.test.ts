import { createScope, type Scope } from '@emdash/shared/concurrency';
import { describe, expect, it, vi } from 'vitest';
import { makeAcpHarness, makeStartInput } from '#runtimes/acp/node/acp-test-support';
import type { AcpConnectionEntry, AcpConnectionSource } from '#runtimes/acp/node/connection/source';
import type { RetainedConversation, SessionRecord } from './conversation-types';
import { SessionMaterializer, type SessionMaterializerCallbacks } from './session-materializer';

describe('SessionMaterializer', () => {
  it('falls back to a fresh session and reapplies retained config overrides', async () => {
    const h = makeAcpHarness();
    h.agent.loadSession.mockRejectedValueOnce(new Error('session file is gone'));
    h.agent.newSession.mockResolvedValueOnce({
      sessionId: 'replacement',
      configOptions: [effortConfigOption('low')],
    });
    const setup = materializerHarness(h, { effort: 'high' });

    const result = await setup.materializer.materialize(
      setup.entry,
      setup.entry.descriptor,
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
});

function materializerHarness(
  harness: ReturnType<typeof makeAcpHarness>,
  configOverrides: RetainedConversation['configOverrides'] = {},
  inputOverrides: Parameters<typeof makeStartInput>[0] = {}
) {
  const input = makeStartInput({
    conversationId: 'conv-materializer',
    sessionId: 'retained-session',
    ...inputOverrides,
  });
  const entry: RetainedConversation = {
    conversationId: input.conversationId,
    descriptor: input,
    configOverrides,
    initialQueueConsumed: true,
    everMaterialized: true,
    deleted: false,
    projection: {} as RetainedConversation['projection'],
    releaseProjection: () => {},
  };
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
    addLoading: (_processOwner, conversationId) => loading.push(conversationId),
    removeLoading: (_processOwner, conversationId) => {
      const index = loading.indexOf(conversationId);
      if (index >= 0) loading.splice(index, 1);
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
  record.machineStateBinding.dispose = record.cell.machine.subscribe(() => {});
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
