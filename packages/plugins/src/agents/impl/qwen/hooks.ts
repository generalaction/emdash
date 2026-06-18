import type { CanonicalHookEvent } from '@emdash/core/agents/plugins';
import {
  buildNestedJsonHookConfig,
  defaultHookEventParser,
  makeStdinHookCommand,
} from '@emdash/core/agents/plugins/helpers';

export const QWEN_HOOKS_PATH = '.qwen/settings.json';

/**
 * Qwen's permission-request hook fires as a notification with
 * `hook_event_name === 'PermissionRequest'` rather than the standard
 * `notification_type` field.
 */
function parseQwenHookEvent(eventType: string, body: Record<string, unknown>): CanonicalHookEvent {
  if (eventType === 'notification' && body.hook_event_name === 'PermissionRequest') {
    return {
      kind: 'status',
      type: 'notification',
      notificationType: 'permission_prompt',
      message: typeof body.message === 'string' ? body.message : undefined,
    };
  }
  return defaultHookEventParser(eventType, body);
}

export function buildQwenHookConfig() {
  return {
    ...buildNestedJsonHookConfig(QWEN_HOOKS_PATH, [
      { hookKey: 'PermissionRequest', command: makeStdinHookCommand('notification') },
      { hookKey: 'Stop', command: makeStdinHookCommand('stop') },
      { hookKey: 'SessionEnd', command: makeStdinHookCommand('stop') },
    ]),
    parseHookEvent: parseQwenHookEvent,
  };
}
