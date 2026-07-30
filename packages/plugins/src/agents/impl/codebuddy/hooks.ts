import type { CanonicalHookEvent, HookRegistration, PluginFs } from '@emdash/core/agents/plugins';
import {
  buildNestedJsonHookConfig,
  defaultHookEventParser,
  makeStdinHookCommand,
} from '@emdash/core/agents/plugins/helpers';

export const CODEBUDDY_SETTINGS_PATH = '.codebuddy/settings.local.json';

function validateCodeBuddySettings(content: string | null): void {
  if (content === null) return;

  let settings: unknown;
  try {
    settings = JSON.parse(content);
  } catch {
    throw new Error(`Cannot update ${CODEBUDDY_SETTINGS_PATH}: file contains invalid JSON`);
  }

  if (typeof settings !== 'object' || settings === null || Array.isArray(settings)) {
    throw new Error(`Cannot update ${CODEBUDDY_SETTINGS_PATH}: expected a JSON object`);
  }
}

function createStrictCodeBuddySettingsFs(fs: PluginFs): PluginFs {
  return {
    ...fs,
    async read(path: string): Promise<string | null> {
      const content = await fs.read(path);
      if (path === CODEBUDDY_SETTINGS_PATH) {
        validateCodeBuddySettings(content);
      }
      return content;
    },
  };
}

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
  const hooks = buildNestedJsonHookConfig(CODEBUDDY_SETTINGS_PATH, [
    { hookKey: 'SessionStart', command: makeStdinHookCommand('session') },
    { hookKey: 'UserPromptSubmit', command: makeStdinHookCommand('start') },
    { hookKey: 'PreToolUse', command: makeStdinHookCommand('start') },
    { hookKey: 'PostToolUseFailure', command: makeStdinHookCommand('error') },
    { hookKey: 'PermissionRequest', command: makeStdinHookCommand('notification') },
    { hookKey: 'Notification', command: makeStdinHookCommand('notification') },
    { hookKey: 'Stop', command: makeStdinHookCommand('stop') },
    { hookKey: 'StopFailure', command: makeStdinHookCommand('error') },
  ]);

  return {
    ...hooks,
    async writeHooks(fs: PluginFs, registrations: HookRegistration[]): Promise<string[]> {
      return hooks.writeHooks(createStrictCodeBuddySettingsFs(fs), registrations);
    },
    async deleteHooks(fs: PluginFs): Promise<void> {
      return hooks.deleteHooks(createStrictCodeBuddySettingsFs(fs));
    },
    parseHookEvent: parseCodeBuddyHookEvent,
  };
}
