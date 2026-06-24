import type { PluginFs } from '@emdash/core/agents/plugins';
import type { HookRegistration } from '@emdash/core/agents/plugins';
import {
  EMDASH_MARKER,
  buildFlatEntry,
  filterUserHooks,
  makeNotificationHookCommand,
  makeStdinHookCommand,
  readJsonConfig,
  writeJsonConfig,
} from '@emdash/core/agents/plugins/helpers';

export const COPILOT_HOOKS_PATH = '.github/hooks/emdash.json';

const COPILOT_MANAGED_HOOK_KEYS = [
  'agentStop',
  'sessionEnd',
  'sessionStart',
  'userPromptSubmitted',
  'errorOccurred',
  'notification',
  'permissionRequest',
];

function hasAllManagedCopilotHooks(hooks: Record<string, unknown[]>): boolean {
  return COPILOT_MANAGED_HOOK_KEYS.every((k) => {
    const entries = Array.isArray(hooks[k]) ? hooks[k] : [];
    return entries.some((e) => JSON.stringify(e).includes(EMDASH_MARKER));
  });
}

export function buildCopilotHookConfig() {
  const stopCmd = makeStdinHookCommand('stop');
  const startCmd = makeStdinHookCommand('start');
  const sessionCmd = makeStdinHookCommand('session');
  const errorCmd = makeStdinHookCommand('error');
  const notificationCmd = makeStdinHookCommand('notification');
  const permCmd = makeNotificationHookCommand('permission_prompt');

  return {
    async readHooks(fs: PluginFs): Promise<HookRegistration[]> {
      const config = await readJsonConfig(fs, COPILOT_HOOKS_PATH);
      const hooks = (config.hooks ?? {}) as Record<string, unknown[]>;
      return hasAllManagedCopilotHooks(hooks) ? [{ event: 'emdash', command: EMDASH_MARKER }] : [];
    },
    async writeHooks(fs: PluginFs, _hooks: HookRegistration[]): Promise<string[]> {
      const config = await readJsonConfig(fs, COPILOT_HOOKS_PATH);
      const hooks = (config.hooks ?? {}) as Record<string, unknown[]>;

      const stopExisting = Array.isArray(hooks.agentStop) ? hooks.agentStop : [];
      hooks.agentStop = [
        ...filterUserHooks(stopExisting as Record<string, unknown>[]),
        buildFlatEntry(stopCmd),
      ];
      const sessionEndExisting = Array.isArray(hooks.sessionEnd) ? hooks.sessionEnd : [];
      hooks.sessionEnd = [
        ...filterUserHooks(sessionEndExisting as Record<string, unknown>[]),
        buildFlatEntry(stopCmd),
      ];
      const sessionExisting = Array.isArray(hooks.sessionStart) ? hooks.sessionStart : [];
      hooks.sessionStart = [
        ...filterUserHooks(sessionExisting as Record<string, unknown>[]),
        buildFlatEntry(sessionCmd),
      ];
      const startExisting = Array.isArray(hooks.userPromptSubmitted)
        ? hooks.userPromptSubmitted
        : [];
      hooks.userPromptSubmitted = [
        ...filterUserHooks(startExisting as Record<string, unknown>[]),
        buildFlatEntry(startCmd),
      ];
      const errorExisting = Array.isArray(hooks.errorOccurred) ? hooks.errorOccurred : [];
      hooks.errorOccurred = [
        ...filterUserHooks(errorExisting as Record<string, unknown>[]),
        buildFlatEntry(errorCmd),
      ];
      const notificationExisting = Array.isArray(hooks.notification) ? hooks.notification : [];
      hooks.notification = [
        ...filterUserHooks(notificationExisting as Record<string, unknown>[]),
        buildFlatEntry(notificationCmd),
      ];
      const permExisting = Array.isArray(hooks.permissionRequest) ? hooks.permissionRequest : [];
      hooks.permissionRequest = [
        ...filterUserHooks(permExisting as Record<string, unknown>[]),
        buildFlatEntry(permCmd),
      ];

      await writeJsonConfig(fs, COPILOT_HOOKS_PATH, { ...config, version: 1, hooks });
      return [COPILOT_HOOKS_PATH];
    },
    async deleteHooks(fs: PluginFs): Promise<void> {
      const config = await readJsonConfig(fs, COPILOT_HOOKS_PATH);
      const hooks = (config.hooks ?? {}) as Record<string, unknown[]>;
      for (const key of Object.keys(hooks)) {
        hooks[key] = filterUserHooks(hooks[key] as Record<string, unknown>[]);
      }
      await writeJsonConfig(fs, COPILOT_HOOKS_PATH, { ...config, hooks });
    },
    async getHooksInstalled(fs: PluginFs): Promise<boolean> {
      const config = await readJsonConfig(fs, COPILOT_HOOKS_PATH);
      const hooks = (config.hooks ?? {}) as Record<string, unknown[]>;
      return hasAllManagedCopilotHooks(hooks);
    },
  };
}
