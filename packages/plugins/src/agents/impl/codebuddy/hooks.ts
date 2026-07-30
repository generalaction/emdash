import type { CanonicalHookEvent } from '@emdash/core/agents/plugins';
import {
  buildNestedJsonHookConfig,
  defaultHookEventParser,
  makeStdinHookCommand,
} from '@emdash/core/agents/plugins/helpers';

export const CODEBUDDY_SETTINGS_PATH = '.codebuddy/settings.local.json';

function parseCodeBuddyHookEvent(
  eventType: string,
  body: Record<string, unknown>
): CanonicalHookEvent {
  if (eventType === 'notification' && body.hook_event_name === 'PermissionRequest') {
    return {
      kind: 'status',
      type: 'notification',
      notificationType: 'permission_prompt',
      title: 'Permission Required',
      message:
        typeof body.message === 'string'
          ? body.message
          : typeof body.tool_name === 'string'
            ? `CodeBuddy Code is requesting permission to use ${body.tool_name}.`
            : undefined,
    };
  }

  return defaultHookEventParser(eventType, body);
}

export function buildCodeBuddyHookConfig() {
  return {
    ...buildNestedJsonHookConfig(CODEBUDDY_SETTINGS_PATH, [
      { hookKey: 'SessionStart', command: makeStdinHookCommand('session') },
      { hookKey: 'UserPromptSubmit', command: makeStdinHookCommand('start') },
      { hookKey: 'PreToolUse', command: makeStdinHookCommand('start') },
      { hookKey: 'PostToolUseFailure', command: makeStdinHookCommand('error') },
      { hookKey: 'PermissionRequest', command: makeStdinHookCommand('notification') },
      { hookKey: 'Notification', command: makeStdinHookCommand('notification') },
      { hookKey: 'Stop', command: makeStdinHookCommand('stop') },
      { hookKey: 'StopFailure', command: makeStdinHookCommand('error') },
    ]),
    parseHookEvent: parseCodeBuddyHookEvent,
  };
}
