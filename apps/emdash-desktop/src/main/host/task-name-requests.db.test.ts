import {
  acpApiContract,
  initialSessionConfigState,
  type TranscriptTurn,
} from '@emdash/core/runtimes/acp/api';
import { closedSessionState, createAcpSessionLiveHost } from '@emdash/core/runtimes/acp/node';
import { err, ok } from '@emdash/shared';
import { defineContract } from '@emdash/wire/rpc';
import { createTestWire } from '@emdash/wire/testing';
import { openFixture } from '@tooling/utils/db';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createConversationRegistry,
  conversationRegistryTable,
} from '@core/features/conversations/api/node/registry';
import { TaskService } from '@core/features/tasks/api/node/task-service';
import { TaskNameRequests } from '@core/features/tasks/node/name-generation/task-name-requests';
import { nameTaskFromConversation } from '@core/features/tasks/node/operations/nameTaskFromConversation';
import { renameTask } from '@core/features/tasks/node/operations/renameTask';
import { tasks } from '@core/services/app-db/node/schema';

const contract = defineContract({ session: acpApiContract.session });
const input = { projectId: 'project-1', taskId: 'task-1', conversationId: 'conversation-1' };

describe('manual conversation AI task names', () => {
  let fixture: Awaited<ReturnType<typeof openFixture>>;
  let host: ReturnType<typeof createAcpSessionLiveHost>;
  let wire: Pick<ReturnType<typeof createTestWire>, 'dispose'>;
  let requests: TaskNameRequests;
  let promptId: string;
  let turns: TranscriptTurn[];
  let revision: number;
  const named = vi.fn();
  const sendPrompt = vi.fn();
  const loadHistory = vi.fn();
  const runtimeClient = vi.fn();

  beforeEach(async () => {
    named.mockClear();
    sendPrompt.mockReset();
    loadHistory.mockReset();
    runtimeClient.mockReset();
    turns = [];
    revision = 0;
    fixture = await openFixture('empty');
    fixture.sqlite.prepare("INSERT INTO projects (id, name) VALUES ('project-1', 'Project')").run();
    await fixture.db.insert(tasks).values({
      id: 'task-1',
      projectId: 'project-1',
      name: 'already-named-task',
      status: 'in_progress',
      workspaceId: 'workspace-1',
      taskBranch: 'original-branch',
    });
    createConversationRegistry(fixture.db).register({
      id: 'conversation-1',
      projectId: 'project-1',
      taskId: 'task-1',
      title: 'Conversation',
      provider: 'fake',
      type: 'acp',
      config: { version: '1', type: 'acp' },
      location: 'local',
      cwd: '/tmp/workspace',
      workspacePath: '/tmp/workspace',
      idRegime: 'provider-minted',
    });
    host = createAcpSessionLiveHost();
    const testWire = createTestWire(contract, { session: host }, { validate: 'full' });
    wire = testWire;
    sendPrompt.mockImplementation(async (request) => {
      promptId = request.promptId;
      return ok({ queued: false });
    });
    loadHistory.mockImplementation(async () =>
      ok({
        kind: 'available',
        turns,
        nextCursor: null,
        position: { generation: 'test', historyRevision: revision, lastCommittedTurnSeq: revision },
        coverage: { fromSeq: null, beforeSeq: null },
      })
    );
    runtimeClient.mockResolvedValue(
      ok({ acp: { session: testWire.client.session, sendPrompt, loadHistory } })
    );
    requests = new TaskNameRequests(
      fixture.db,
      { client: runtimeClient } as never,
      async () => false,
      named
    );
  });

  afterEach(async () => {
    requests.cancelTask('task-1');
    await wire.dispose();
    fixture.close();
  });

  function task() {
    return fixture.db.select().from(tasks).where(eq(tasks.id, 'task-1')).get()!;
  }

  function reply(
    name: string,
    id = promptId,
    outcome: TranscriptTurn['outcome'] = { kind: 'done' }
  ) {
    revision++;
    turns.push({
      id: `turn-${revision}`,
      seq: revision,
      initiator: 'user',
      outcome,
      items: [
        {
          kind: 'message',
          id: `user-${revision}`,
          seq: 0,
          role: 'user',
          promptId: id,
          text: 'Name this task',
        },
        { kind: 'message', id: `assistant-${revision}`, seq: 1, role: 'assistant', text: name },
      ],
    });
    host.models('conversation-1').source.set({
      kind: 'active',
      snapshot: {
        state: {
          ...closedSessionState,
          lifecycle: 'ready',
          canSubmit: true,
          transcript: {
            generation: 'test',
            historyRevision: revision,
            lastCommittedTurnSeq: revision,
            activeTurn: null,
          },
        },
        config: initialSessionConfigState,
        usage: null,
        plan: null,
        agents: [],
        terminals: [],
        mcpServers: [],
      },
    });
  }

  it('renames an already named task using the current conversation and a correlated reply', async () => {
    expect((await requests.request(input)).success).toBe(true);
    expect(sendPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conversation-1',
        prompt: expect.objectContaining({
          hiddenContext: expect.stringContaining('up to five words'),
        }),
      })
    );
    reply('Fix login timeout');
    await vi.waitFor(() => expect(task().name).toBe('fix-login-timeout'));
    expect(named).toHaveBeenCalledTimes(1);
    expect(task()).toMatchObject({ workspaceId: 'workspace-1', taskBranch: 'original-branch' });
  });

  it.each(['unavailable-runtime', 'rejected-prompt', 'failed-lookup'])(
    'preserves automatic naming when a manual request fails: %s',
    async (failure) => {
      await fixture.db
        .update(tasks)
        .set({
          name: 'generated-placeholder',
          autoNameConversationId: 'conversation-1',
        })
        .where(eq(tasks.id, 'task-1'));
      if (failure === 'unavailable-runtime') {
        runtimeClient.mockResolvedValueOnce(err({ message: 'Fixture runtime unavailable' }));
      } else if (failure === 'failed-lookup') {
        runtimeClient.mockRejectedValueOnce(new Error('Fixture lookup failure'));
      } else {
        sendPrompt.mockResolvedValueOnce(err({ message: 'Fixture prompt rejected' }));
      }

      expect(await requests.request(input)).toMatchObject({ success: false });
      expect(task().autoNameConversationId).toBe('conversation-1');
      await nameTaskFromConversation(fixture.db, 'conversation-1', 'Fix login timeout');
      expect(task().name).toBe('fix-login-timeout');
    }
  );

  it('consumes automatic naming eligibility once the manual prompt is accepted', async () => {
    await fixture.db
      .update(tasks)
      .set({
        autoNameConversationId: 'conversation-1',
      })
      .where(eq(tasks.id, 'task-1'));

    expect(await requests.request(input)).toMatchObject({ success: true });
    expect(task().autoNameConversationId).toBeNull();
  });

  it('does not send a prompt after a manual rename cancels a pending runtime lookup', async () => {
    const availableRuntime = await runtimeClient();
    let finishLookup: () => void = () => {};
    runtimeClient.mockReturnValueOnce(
      new Promise((resolve) => {
        finishLookup = () => resolve(availableRuntime);
      })
    );
    const service = new TaskService({
      db: fixture.db,
      runtimes: { client: runtimeClient },
      getTaskSettings: async () => ({ preserveNameCapitalization: false }),
    } as never);

    const requested = service.requestTaskName(input);
    await service.renameTask('project-1', 'task-1', 'my-new-name');
    finishLookup();
    expect(await requested).toMatchObject({
      success: false,
      error: { type: 'request-failed', message: 'The task naming request was canceled.' },
    });

    expect(sendPrompt).not.toHaveBeenCalled();
    expect(task().name).toBe('my-new-name');
  });

  it('ignores another turn and applies only the requested reply', async () => {
    await requests.request(input);
    reply('Unrelated work', 'another-prompt');
    await vi.waitFor(() => expect(loadHistory).toHaveBeenCalled());
    expect(task().name).toBe('already-named-task');
    reply('Improve task naming');
    await vi.waitFor(() => expect(task().name).toBe('improve-task-naming'));
  });

  it('retries a transient history read without needing another committed revision', async () => {
    await requests.request(input);
    loadHistory.mockResolvedValueOnce(ok({ kind: 'unavailable' }));
    reply('Improve task naming');
    await vi.waitFor(() => expect(task().name).toBe('improve-task-naming'));
    expect(loadHistory).toHaveBeenCalledTimes(2);
  });

  it('preserves a manual rename made while the AI is responding', async () => {
    await requests.request(input);
    await renameTask(fixture.db, 'project-1', 'task-1', 'my-new-name');
    reply('Improve task naming');
    await vi.waitFor(() => expect(loadHistory).toHaveBeenCalled());
    expect(task().name).toBe('my-new-name');
    expect(named).not.toHaveBeenCalled();
  });

  it.each(['one two three four five six', 'The name is: task naming', 'a'.repeat(65)])(
    'keeps the previous name for an invalid response: %s',
    async (name) => {
      await requests.request(input);
      reply(name);
      await vi.waitFor(() => expect(loadHistory).toHaveBeenCalled());
      expect(task().name).toBe('already-named-task');
      expect(named).not.toHaveBeenCalled();
    }
  );

  it('does not rename from a canceled turn', async () => {
    await requests.request(input);
    reply('Improve task naming', promptId, { kind: 'cancelled' });
    await vi.waitFor(() => expect(loadHistory).toHaveBeenCalled());
    expect(task().name).toBe('already-named-task');
  });

  it('rejects a conversation outside the requested task', async () => {
    const result = await requests.request({ ...input, conversationId: 'missing-conversation' });
    expect(result).toMatchObject({ success: false, error: { type: 'conversation-not-found' } });
    expect(sendPrompt).not.toHaveBeenCalled();
  });

  it('preserves provider-controlled terminal slash commands', async () => {
    await fixture.db
      .update(conversationRegistryTable)
      .set({ type: 'pty' })
      .where(eq(conversationRegistryTable.id, 'conversation-1'));
    expect(await requests.request(input)).toMatchObject({
      success: false,
      error: { type: 'unsupported-conversation' },
    });
    expect(sendPrompt).not.toHaveBeenCalled();
  });
});
