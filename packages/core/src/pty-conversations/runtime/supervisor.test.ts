import { describe, expect, it, vi } from 'vitest';
import type { PtyHandle } from '../transport';
import {
  CONVERSATION_FRESH_RECOVERY_GRACE_MS,
  MAX_CONVERSATION_RESUME_ATTEMPTS,
  SessionRespawnPolicy,
} from './supervisor';

function fakePty(): PtyHandle {
  return {
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    onData: vi.fn(),
    onExit: vi.fn(),
  };
}

describe('SessionRespawnPolicy', () => {
  it('rejects a spawn that returns after explicit stop invalidated its token', () => {
    const policy = new SessionRespawnPolicy();
    const token = policy.beginStart();
    expect(token).toBeDefined();

    policy.stop();

    const pty = fakePty();
    expect(policy.acceptSpawn(token!, pty)).toBe(false);
  });

  it('falls back to a fresh replacement after one resume exit', () => {
    const policy = new SessionRespawnPolicy();
    const initial = fakePty();
    const initialToken = policy.beginStart({ mode: 'fresh' });
    expect(policy.acceptSpawn(initialToken!, initial)).toBe(true);

    expect(policy.handleExit(initial)).toEqual({ kind: 'respawnResume' });

    for (let attempt = 1; attempt <= MAX_CONVERSATION_RESUME_ATTEMPTS; attempt += 1) {
      const pty = fakePty();
      const token = policy.beginStart({
        requireDesired: true,
        mode: 'resume',
      });
      expect(policy.acceptSpawn(token!, pty)).toBe(true);

      const decision = policy.handleExit(pty);
      if (attempt < MAX_CONVERSATION_RESUME_ATTEMPTS) {
        expect(decision).toEqual({ kind: 'respawnResume' });
      } else {
        expect(decision).toEqual({ kind: 'respawnFresh' });
      }
    }
  });

  it('fails when a fresh recovery exits before the startup grace period', () => {
    const policy = new SessionRespawnPolicy();
    const first = fakePty();
    const firstToken = policy.beginStart({ mode: 'resume' });
    expect(policy.acceptSpawn(firstToken!, first)).toBe(true);

    expect(policy.handleExit(first)).toEqual({ kind: 'respawnFresh' });

    const fresh = fakePty();
    const freshToken = policy.beginStart({
      requireDesired: true,
      mode: 'fresh',
    });
    expect(policy.acceptSpawn(freshToken!, fresh)).toBe(true);
    expect(policy.handleExit(fresh)).toEqual({ kind: 'failed' });
    expect(policy.isDesired()).toBe(false);
  });

  it('resets recovery after a fresh replacement survives the startup grace period', () => {
    vi.useFakeTimers();
    try {
      const policy = new SessionRespawnPolicy();
      const first = fakePty();
      const firstToken = policy.beginStart({ mode: 'resume' });
      expect(policy.acceptSpawn(firstToken!, first)).toBe(true);

      expect(policy.handleExit(first)).toEqual({ kind: 'respawnFresh' });

      const fresh = fakePty();
      const freshToken = policy.beginStart({
        requireDesired: true,
        mode: 'fresh',
      });
      expect(policy.acceptSpawn(freshToken!, fresh)).toBe(true);

      vi.advanceTimersByTime(CONVERSATION_FRESH_RECOVERY_GRACE_MS);
      expect(policy.handleExit(fresh)).toEqual({ kind: 'respawnResume' });

      const retry = fakePty();
      const retryToken = policy.beginStart({
        requireDesired: true,
        mode: 'resume',
      });
      expect(policy.acceptSpawn(retryToken!, retry)).toBe(true);
      expect(policy.handleExit(retry)).toEqual({ kind: 'respawnFresh' });
    } finally {
      vi.useRealTimers();
    }
  });
});
