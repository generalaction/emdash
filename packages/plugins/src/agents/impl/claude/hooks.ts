import type { CanonicalHookEvent } from '@emdash/core/services/agent-plugins/api/plugins';
import {
  buildNestedJsonHookConfig,
  configRoots,
  defaultHookEventParser,
  envConfigRoot,
  extractProviderSessionId,
  makeNotificationHookCommand,
  makeStdinHookCommand,
} from '@emdash/core/services/agent-plugins/api/plugins/helpers';

export const CLAUDE_SETTINGS_PATH = 'settings.json';

/**
 * Honor explicit Notification types; older Claude versions only provided a message.
 * For those versions classify by examining the message text:
 *   /permission|approval/i → permission_prompt
 *   everything else        → idle_prompt (agent waiting / done)
 *
 * Every Claude hook payload includes `session_id`, and it changes when the user
 * switches sessions inside the TUI (`/resume`). Status events carry it so the
 * runtime resumes the session Claude is actually in, not the one it launched with.
 */
function parseClaudeHookEvent(
  eventType: string,
  body: Record<string, unknown>
): CanonicalHookEvent {
  if (eventType === 'pre-tool-use' && body.tool_name !== 'AskUserQuestion') {
    return { kind: 'ignore' };
  }
  const event: CanonicalHookEvent =
    eventType === 'pre-tool-use'
      ? {
          kind: 'status',
          type: 'notification',
          notificationType: 'elicitation_dialog',
          toolUseId: typeof body.tool_use_id === 'string' ? body.tool_use_id : undefined,
        }
      : eventType === 'notification'
        ? parseClaudeNotification(body)
        : defaultHookEventParser(eventType, body);
  if (event.kind !== 'status') return event;
  const providerSessionId = extractProviderSessionId(body);
  return providerSessionId ? { ...event, providerSessionId } : event;
}

function parseClaudeNotification(body: Record<string, unknown>): CanonicalHookEvent {
  const explicit = defaultHookEventParser('notification', body);
  if (explicit.kind === 'status' && explicit.notificationType) return explicit;
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

export function buildClaudeHookConfig() {
  return {
    ...buildNestedJsonHookConfig(CLAUDE_SETTINGS_PATH, [
      { hookKey: 'SessionStart', command: makeStdinHookCommand('session-start') },
      { hookKey: 'UserPromptSubmit', command: makeStdinHookCommand('start') },
      { hookKey: 'Notification', command: makeStdinHookCommand('notification') },
      { hookKey: 'PermissionRequest', command: makeNotificationHookCommand('permission_prompt') },
      { hookKey: 'PreToolUse', command: makeStdinHookCommand('pre-tool-use') },
      { hookKey: 'PostToolUse', command: makeStdinHookCommand('start') },
      { hookKey: 'PostToolUseFailure', command: makeStdinHookCommand('start') },
      { hookKey: 'Stop', command: makeStdinHookCommand('stop') },
    ]),
    resolveConfigRoots: configRoots(envConfigRoot('CLAUDE_CONFIG_DIR', '.claude')),
    parseHookEvent: parseClaudeHookEvent,
  };
}
