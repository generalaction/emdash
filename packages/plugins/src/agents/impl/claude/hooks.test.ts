import { describe, expect, it } from 'vitest';
import { buildClaudeHookConfig } from './hooks';

describe('buildClaudeHookConfig', () => {
  it('uses explicit notification_type before message heuristics', () => {
    const hooks = buildClaudeHookConfig();

    expect(
      hooks.parseHookEvent('notification', { notification_type: 'permission_prompt' })
    ).toEqual({
      kind: 'status',
      type: 'notification',
      notificationType: 'permission_prompt',
      lastAssistantMessage: undefined,
      title: undefined,
      message: undefined,
    });
  });

  it('classifies Claude notification messages when no notification_type is present', () => {
    const hooks = buildClaudeHookConfig();

    expect(hooks.parseHookEvent('notification', { message: 'Claude needs approval' })).toEqual({
      kind: 'status',
      type: 'notification',
      notificationType: 'permission_prompt',
      message: 'Claude needs approval',
      title: undefined,
    });
  });
});
