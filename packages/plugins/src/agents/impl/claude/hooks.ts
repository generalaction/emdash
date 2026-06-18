import type { CanonicalHookEvent, NotificationType } from '@emdash/core/agents/plugins';
import {
  buildNestedJsonHookConfig,
  defaultHookEventParser,
  makeStdinHookCommand,
} from '@emdash/core/agents/plugins/helpers';

export const CLAUDE_SETTINGS_PATH = '.claude/settings.local.json';

/**
 * Prefer Claude's structured notification type when present.
 * Older payloads are classified by message text:
 *   /permission|approval/i → permission_prompt
 *   everything else        → idle_prompt (agent waiting / done)
 */
const CLAUDE_NOTIFICATION_TYPES = new Set<NotificationType>([
  'permission_prompt',
  'idle_prompt',
  'auth_success',
  'elicitation_dialog',
]);

function getClaudeNotificationType(body: Record<string, unknown>): NotificationType | undefined {
  const value = body.notification_type ?? body.notificationType;
  return typeof value === 'string' && CLAUDE_NOTIFICATION_TYPES.has(value as NotificationType)
    ? (value as NotificationType)
    : undefined;
}

function parseClaudeHookEvent(
  eventType: string,
  body: Record<string, unknown>
): CanonicalHookEvent {
  if (eventType === 'notification') {
    const message = typeof body.message === 'string' ? body.message : '';
    const structuredNotificationType = getClaudeNotificationType(body);
    if (structuredNotificationType) {
      return {
        kind: 'status',
        type: 'notification',
        notificationType: structuredNotificationType,
        message: message || undefined,
        title: typeof body.title === 'string' ? body.title : undefined,
      };
    }
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
      { hookKey: 'UserPromptSubmit', command: makeStdinHookCommand('start') },
      { hookKey: 'Notification', command: makeStdinHookCommand('notification') },
      { hookKey: 'Stop', command: makeStdinHookCommand('stop') },
    ]),
    parseHookEvent: parseClaudeHookEvent,
  };
}
