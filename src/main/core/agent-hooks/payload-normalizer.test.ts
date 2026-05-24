import { describe, expect, it } from 'vitest';
import { normalizePayload } from './payload-normalizer';

describe('normalizePayload', () => {
  it('classifies Claude Notification approval prompts as permission_prompt', () => {
    for (const message of [
      'Allow Bash to run?',
      'Do you want to grant Bash access?',
      'Claude needs your permission to use Bash',
    ]) {
      const payload = normalizePayload('claude', 'notification', { message });

      expect(payload.notificationType).toBe('permission_prompt');
      expect(payload.message).toBe(message);
    }
  });

  it('does not classify incidental permission mentions as permission_prompt', () => {
    const payload = normalizePayload('claude', 'notification', {
      message: 'Claude is waiting for your input about permission handling',
    });
    expect(payload.notificationType).toBe('idle_prompt');
  });

  it('classifies Claude Notification without an approval prompt as idle_prompt', () => {
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
