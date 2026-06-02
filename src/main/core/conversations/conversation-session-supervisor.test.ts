import { describe, expect, it, vi } from 'vitest';
import type { Pty } from '@main/core/pty/pty';
import {
  MAX_CONVERSATION_RESUME_ATTEMPTS,
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
  it('rejects and kills a spawn that returns after explicit stop invalidated its token', () => {
    const supervisor = new ConversationSessionSupervisor();
    const token = supervisor.beginStart('session-1');
    expect(token).toBeDefined();

    supervisor.stop('session-1');

    const pty = fakePty();
    expect(supervisor.acceptSpawn('session-1', token!, pty)).toBe(false);
  });

  it('falls back to a fresh replacement after one resume exit', () => {
    const supervisor = new ConversationSessionSupervisor();
    const initial = fakePty();
    const initialToken = supervisor.beginStart('session-1', { mode: 'fresh' });
    expect(supervisor.acceptSpawn('session-1', initialToken!, initial)).toBe(true);

    expect(supervisor.handleExit('session-1', initial)).toEqual({ kind: 'respawnResume' });

    for (let attempt = 1; attempt <= MAX_CONVERSATION_RESUME_ATTEMPTS; attempt += 1) {
      const pty = fakePty();
      const token = supervisor.beginStart('session-1', {
        requireDesired: true,
        mode: 'resume',
      });
      expect(supervisor.acceptSpawn('session-1', token!, pty)).toBe(true);

      const decision = supervisor.handleExit('session-1', pty);
      if (attempt < MAX_CONVERSATION_RESUME_ATTEMPTS) {
        expect(decision).toEqual({ kind: 'respawnResume' });
      } else {
        expect(decision).toEqual({ kind: 'respawnFresh' });
      }
    }
  });

  it('resets the resume exit count after a fresh spawn', () => {
    const supervisor = new ConversationSessionSupervisor();
    const first = fakePty();
    const firstToken = supervisor.beginStart('session-1', { mode: 'resume' });
    expect(supervisor.acceptSpawn('session-1', firstToken!, first)).toBe(true);

    expect(supervisor.handleExit('session-1', first)).toEqual({ kind: 'respawnFresh' });

    const fresh = fakePty();
    const freshToken = supervisor.beginStart('session-1', {
      requireDesired: true,
      mode: 'fresh',
    });
    expect(supervisor.acceptSpawn('session-1', freshToken!, fresh)).toBe(true);
    expect(supervisor.handleExit('session-1', fresh)).toEqual({ kind: 'respawnResume' });

    const retry = fakePty();
    const retryToken = supervisor.beginStart('session-1', {
      requireDesired: true,
      mode: 'resume',
    });
    expect(supervisor.acceptSpawn('session-1', retryToken!, retry)).toBe(true);
    expect(supervisor.handleExit('session-1', retry)).toEqual({ kind: 'respawnFresh' });
  });
});
