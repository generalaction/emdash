import { createMemoryKeyValueStore } from '@primitives/kv/api';
import { describe, expect, it } from 'vitest';
import { SessionIntentsRuntime } from './component';

describe('SessionIntentsRuntime', () => {
  it('upserts, lists, suspends, and deletes intents within a scope', async () => {
    const runtime = new SessionIntentsRuntime(createMemoryKeyValueStore());

    await expect(
      runtime.upsert('acp', {
        conversationId: 'conv-1',
        status: 'active',
        payload: { conversationId: 'conv-1', cwd: '/repo' },
        sessionId: 'session-1',
        updatedAt: 1,
      })
    ).resolves.toEqual({ success: true });
    await runtime.upsert('tui-agents', {
      conversationId: 'conv-1',
      status: 'active',
      payload: { conversationId: 'conv-1', cwd: '/repo' },
      updatedAt: 2,
    });

    await expect(runtime.list('acp')).resolves.toEqual({
      success: true,
      data: [
        {
          conversationId: 'conv-1',
          status: 'active',
          payload: { conversationId: 'conv-1', cwd: '/repo' },
          sessionId: 'session-1',
          updatedAt: 1,
        },
      ],
    });

    await runtime.setStatus('acp', 'conv-1', 'suspended', 'idle');
    const suspended = await runtime.list('acp');

    expect(suspended.success ? suspended.data[0] : null).toMatchObject({
      conversationId: 'conv-1',
      status: 'suspended',
      suspendedCause: 'idle',
    });

    await runtime.delete('acp', 'conv-1');
    await expect(runtime.list('acp')).resolves.toEqual({ success: true, data: [] });
    await expect(runtime.list('tui-agents')).resolves.toEqual({
      success: true,
      data: [
        {
          conversationId: 'conv-1',
          status: 'active',
          payload: { conversationId: 'conv-1', cwd: '/repo' },
          updatedAt: 2,
        },
      ],
    });
  });

  it('ignores malformed entries when listing', async () => {
    const runtime = new SessionIntentsRuntime(
      createMemoryKeyValueStore({
        'session-intents:acp:bad': { status: 'active' },
        'session-intents:acp:good': {
          conversationId: 'good',
          status: 'active',
          payload: { conversationId: 'good' },
          updatedAt: 1,
        },
      })
    );

    await expect(runtime.list('acp')).resolves.toEqual({
      success: true,
      data: [
        {
          conversationId: 'good',
          status: 'active',
          payload: { conversationId: 'good' },
          updatedAt: 1,
        },
      ],
    });
  });
});
