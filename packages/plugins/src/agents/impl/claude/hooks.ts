import type { CanonicalHookEvent } from '@emdash/core/agents/plugins';
import {
  buildNestedJsonHookConfig,
  defaultHookEventParser,
  makeNotificationHookCommand,
  makeStdinHookCommand,
} from '@emdash/core/agents/plugins/helpers';

export const CLAUDE_SETTINGS_PATH = '.claude/settings.local.json';

/**
 * Claude's Notification events usually carry no `notification_type` field.
 * Classify those by examining the message text:
 *   /permission|approval/i → permission_prompt
 *   everything else        → idle_prompt (agent waiting / done)
 */
function parseClaudeHookEvent(
  eventType: string,
  body: Record<string, unknown>
): CanonicalHookEvent {
  if (eventType === 'notification') {
    if (body.notification_type || body.notificationType) {
      return defaultHookEventParser(eventType, body);
    }

    const message = typeof body.message === 'string' ? body.message : '';
    const notificationType = /permission|approval/i.test(message)
      ? ('permission_prompt' as const)
      : ('idle_prompt' as const);
    return {
      kind: 'status',
      type: 'notification',
      notificationType,
      message: message || undefined,
      title: typeof body.title === 'string' ? body.title : undefined,
    };
  }

  return defaultHookEventParser(eventType, body);
}

export function buildClaudeHookConfig() {
  return {
    ...buildNestedJsonHookConfig(CLAUDE_SETTINGS_PATH, [
      { hookKey: 'SessionStart', command: makeStdinHookCommand('session') },
      { hookKey: 'UserPromptSubmit', command: makeStdinHookCommand('start') },
      { hookKey: 'PermissionRequest', command: makeNotificationHookCommand('permission_prompt') },
      { hookKey: 'Notification', command: makeStdinHookCommand('notification') },
      { hookKey: 'Stop', command: makeStdinHookCommand('stop') },
      { hookKey: 'StopFailure', command: makeStdinHookCommand('error') },
      { hookKey: 'SessionEnd', command: makeStdinHookCommand('stop') },
    ]),
    parseHookEvent: parseClaudeHookEvent,
  };
}
