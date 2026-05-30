import { describe, expect, it, vi } from 'vitest';
import type { Pty } from '@main/core/pty/pty';
import {
  CONVERSATION_REPLACEMENT_SUSTAINED_MS,
  ConversationSessionSupervisor,
} from './conversation-session-supervisor';

function fakePty(): Pty {
  return {
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    onData: vi.fn(),
    onExit: vi.fn(),
  };
}

describe('ConversationSessionSupervisor', () => {
  it('rejects and kills a spawn that returns after explicit stop invalidated its generation', () => {
    const supervisor = new ConversationSessionSupervisor();
    const token = supervisor.beginStart('session-1');
    expect(token).toBeDefined();

    supervisor.stop('session-1');

    const pty = fakePty();
    expect(supervisor.acceptSpawn('session-1', token!, pty)).toBe(false);
  });

  it('allows one replacement inside a failure window and then fails until sustained running resets it', () => {
    vi.useFakeTimers();
    try {
      const supervisor = new ConversationSessionSupervisor();
      const first = fakePty();
      const second = fakePty();
      const firstToken = supervisor.beginStart('session-1');
      expect(supervisor.acceptSpawn('session-1', firstToken!, first)).toBe(true);

      expect(supervisor.handleExit('session-1', first)).toEqual({ kind: 'replace' });
      const secondToken = supervisor.beginStart('session-1', {
        requireDesired: true,
      });
      expect(supervisor.acceptSpawn('session-1', secondToken!, second)).toBe(true);
      expect(supervisor.handleExit('session-1', second)).toEqual({ kind: 'failed' });

      const third = fakePty();
      const thirdToken = supervisor.beginStart('session-2');
      expect(supervisor.acceptSpawn('session-2', thirdToken!, third)).toBe(true);
      expect(supervisor.handleExit('session-2', third)).toEqual({ kind: 'replace' });
      const fourth = fakePty();
      const fourthToken = supervisor.beginStart('session-2', {
        requireDesired: true,
      });
      expect(supervisor.acceptSpawn('session-2', fourthToken!, fourth)).toBe(true);
      vi.advanceTimersByTime(CONVERSATION_REPLACEMENT_SUSTAINED_MS);
      expect(supervisor.handleExit('session-2', fourth)).toEqual({ kind: 'replace' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears the replacement failure window after a spawn failure', () => {
    const supervisor = new ConversationSessionSupervisor();
    const first = fakePty();
    const firstToken = supervisor.beginStart('session-1');
    expect(supervisor.acceptSpawn('session-1', firstToken!, first)).toBe(true);

    expect(supervisor.handleExit('session-1', first)).toEqual({ kind: 'replace' });
    const failedToken = supervisor.beginStart('session-1', {
      requireDesired: true,
    });
    expect(failedToken).toBeDefined();
    supervisor.failSpawn('session-1', failedToken!);

    const retry = fakePty();
    const retryToken = supervisor.beginStart('session-1', {
      requireDesired: true,
    });
    expect(supervisor.acceptSpawn('session-1', retryToken!, retry)).toBe(true);
    expect(supervisor.handleExit('session-1', retry)).toEqual({ kind: 'replace' });
  });
});
