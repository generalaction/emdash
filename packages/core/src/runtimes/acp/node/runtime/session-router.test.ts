import type { SessionNotification } from '@agentclientprotocol/sdk';
import { noopLogger } from '@emdash/shared/logger';
import { describe, expect, it, vi } from 'vitest';
import type { NormalizedEvent } from '#runtimes/acp/api';
import type { AcpConnectionContext } from '#runtimes/acp/node/connection/source';
import { SessionRouter, type SessionRouteTarget } from './session-router';

describe('SessionRouter', () => {
  it('drops unknown updates instead of retaining them for a later registration', () => {
    const target = targetSpy();
    const router = new SessionRouter(target, noopLogger);
    const connection = context(1);
    const owner = 'claude:/repo:1';

    router.onSessionUpdate(connection, notification('late', 'first'), event('first'));
    router.register(owner, 'late', 'conversation-a');

    expect(target.onSessionUpdate).not.toHaveBeenCalled();
  });

  it('routes the requested and rebound session ids during one scoped load', () => {
    const target = targetSpy();
    const router = new SessionRouter(target, noopLogger);
    const connection = context(1);
    const endLoad = router.beginLoad('claude:/repo:1', 'requested', 'conversation-a');

    router.onSessionUpdate(connection, notification('requested', 'first'), event('first'));
    router.onSessionUpdate(connection, notification('rebound', 'first'), event('first'));

    expect(target.onSessionUpdate).toHaveBeenCalledTimes(2);
    expect(target.onSessionUpdate.mock.calls.map(([, , params]) => params.sessionId)).toEqual([
      'requested',
      'rebound',
    ]);

    endLoad();
    router.onSessionUpdate(connection, notification('unknown', 'after'), event('after'));
    expect(target.onSessionUpdate).toHaveBeenCalledTimes(2);
  });

  it('rejects overlapping provisional loads for one process owner', () => {
    const router = new SessionRouter(targetSpy(), noopLogger);
    const owner = 'claude:/repo:1';
    const endLoad = router.beginLoad(owner, 'session-a', 'conversation-a');

    expect(() => router.beginLoad(owner, 'session-b', 'conversation-b')).toThrow(
      'ACP load already active'
    );

    endLoad();
    const endSecondLoad = router.beginLoad(owner, 'session-b', 'conversation-b');
    endSecondLoad();
  });

  it('drops routes and provisional loading state when a generation is invalidated', () => {
    const target = targetSpy();
    const router = new SessionRouter(target, noopLogger);
    const connection = context(1);
    const owner = 'claude:/repo:1';
    router.beginLoad(owner, 'loaded', 'conversation-a');

    router.invalidate(owner);
    router.onSessionUpdate(connection, notification('loaded', 'first'), event('first'));
    router.onSessionUpdate(connection, notification('rebound', 'second'), event('second'));

    expect(target.onSessionUpdate).not.toHaveBeenCalled();
    expect(router.hasRoutesFor('conversation-a')).toBe(false);
    expect(router.isLoadingConversation('conversation-a')).toBe(false);
  });
});

function targetSpy() {
  return {
    onSessionUpdate: vi.fn<SessionRouteTarget['onSessionUpdate']>(),
    onPermissionRequest: vi.fn<SessionRouteTarget['onPermissionRequest']>(),
    onCreateTerminal: vi.fn<SessionRouteTarget['onCreateTerminal']>(),
  };
}

function context(generation: number): AcpConnectionContext {
  return {
    key: 'claude:/repo',
    generation,
    providerId: 'claude',
    cwd: '/repo',
    normalize: vi.fn(),
  };
}

function notification(sessionId: string, sessionUpdate: string): SessionNotification {
  return {
    sessionId,
    update: { sessionUpdate } as SessionNotification['update'],
  };
}

function event(id: string): NormalizedEvent {
  return { type: 'unknown', raw: { id } } as unknown as NormalizedEvent;
}
