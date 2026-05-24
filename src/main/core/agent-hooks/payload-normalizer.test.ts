import { describe, expect, it } from 'vitest';
import { normalizePayload } from './payload-normalizer';

describe('normalizePayload', () => {
  it('classifies Claude Notification with "permission" in message as permission_prompt', () => {
    const payload = normalizePayload('claude', 'notification', {
      message: 'Claude needs your permission to use Bash',
    });
    expect(payload.notificationType).toBe('permission_prompt');
    expect(payload.message).toBe('Claude needs your permission to use Bash');
  });

  it('classifies Claude Notification without "permission" as idle_prompt', () => {
    const payload = normalizePayload('claude', 'notification', {
      message: 'Claude is waiting for your input',
    });
    expect(payload.notificationType).toBe('idle_prompt');
  });

  it('does not override an explicit notification_type on Claude payloads', () => {
    const payload = normalizePayload('claude', 'notification', {
      notification_type: 'elicitation_dialog',
      message: 'permission denied',
    });
    expect(payload.notificationType).toBe('elicitation_dialog');
  });

  it('leaves non-notification Claude events without a notificationType', () => {
    const payload = normalizePayload('claude', 'start', {});
    expect(payload.notificationType).toBeUndefined();
  });

  it('defaults Codex agent-turn-complete to idle_prompt', () => {
    const payload = normalizePayload('codex', 'notification', { type: 'agent-turn-complete' });
    expect(payload.notificationType).toBe('idle_prompt');
  });
});
