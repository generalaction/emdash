import { homedir } from 'node:os';
import * as toml from 'smol-toml';
import { resolveCommandPath } from '@main/core/dependencies/probe';
import type { IExecutionContext } from '@main/core/execution-context/types';
import { LocalFileSystem } from '@main/core/fs/impl/local-fs';
import type { FileSystemProvider } from '@main/core/fs/types';
import { log } from '@main/lib/logger';
import type { AgentProviderId } from '@shared/agent-provider-registry';
import type { AgentEventType, NotificationType } from '@shared/events/agentEvents';
import {
  makeAmpPluginContent,
  makeClaudeHookCommand,
  makeCodexHookCommand,
  makeCodexSessionStartHookCommand,
  makeNotificationHookCommand,
  makeOpenCodePluginContent,
} from './agent-notify-command';
import piEmdashExtension from './pi-emdash-extension.ts?raw';

const EMDASH_MARKER = 'EMDASH_HOOK_PORT';

const CLAUDE_SETTINGS_PATH = '.claude/settings.local.json';
const CODEX_CONFIG_PATH = '.codex/config.toml';
const CODEX_HOOKS_PATH = '.codex/hooks.json';
const DROID_SETTINGS_PATH = '.factory/settings.json';
const AMP_PLUGIN_PATH = '.amp/plugins/emdash-hook.ts';
const PI_EMDASH_EXTENSION_PATH = '.pi/extensions/emdash-hook.ts';
const OPENCODE_PLUGIN_PATH = '.opencode/plugins/emdash-notifications.js';
const GITIGNORE_PATH = '.gitignore';
type HookConfigWriteOptions = { writeGitIgnoreEntries?: boolean };
type HookEntryConfig = { command: string; matcher?: string };
type ClaudeHookConfig = {
  eventType: AgentEventType;
  hookKey: string;
  matcher?: string;
  notificationType?: NotificationType;
};
type CodexHookEvent = 'Stop' | 'PermissionRequest' | 'SessionStart';
type DroidHookEvent = 'Notification' | 'Stop' | 'SessionStart';

// Claude Code hook map. Notification matchers provide typed attention events
// without parsing notification text. Start events keep the task status in sync
// when Claude enters tool or MCP elicitation flows.
const CLAUDE_HOOK_EVENT_MAP = [
  {
    eventType: 'notification',
    hookKey: 'Notification',
    matcher: 'permission_prompt',
    notificationType: 'permission_prompt',
  },
  {
    eventType: 'notification',
    hookKey: 'Notification',
    matcher: 'idle_prompt',
    notificationType: 'idle_prompt',
  },
  {
    eventType: 'notification',
    hookKey: 'Notification',
    matcher: 'elicitation_dialog',
    notificationType: 'elicitation_dialog',
  },
  { eventType: 'stop', hookKey: 'Stop' },
  { eventType: 'start', hookKey: 'PreToolUse' },
  { eventType: 'start', hookKey: 'ElicitationResult' },
] satisfies ClaudeHookConfig[];

const CODEX_HOOK_EVENT_MAP = [
  { hookKey: 'Stop', notificationType: 'idle_prompt' },
  { hookKey: 'PermissionRequest', notificationType: 'permission_prompt' },
] satisfies { hookKey: CodexHookEvent; notificationType: 'idle_prompt' | 'permission_prompt' }[];

const CODEX_SESSION_HOOK_EVENT_MAP = [{ hookKey: 'SessionStart' as const }] satisfies {
  hookKey: CodexHookEvent;
}[];

const DROID_HOOK_EVENT_MAP = [
  { hookKey: 'Notification', eventType: 'notification' },
  { hookKey: 'Stop', eventType: 'stop' },
  { hookKey: 'SessionStart', eventType: 'session' },
] satisfies { hookKey: DroidHookEvent; eventType: 'notification' | 'stop' | 'session' }[];

const LEGACY_CODEX_NOTIFY_COMMAND = [
  'bash',
  '-c',
  'curl -sf -X POST ' +
    "-H 'Content-Type: application/json' " +
    '-H "X-Emdash-Token: $EMDASH_HOOK_TOKEN" ' +
    '-H "X-Emdash-Pty-Id: $EMDASH_PTY_ID" ' +
    '-H "X-Emdash-Event-Type: notification" ' +
    '-d "$1" ' +
    '"http://127.0.0.1:$EMDASH_HOOK_PORT/hook" || true',
  '_',
];

export class HookConfigWriter {
  private readonly userFs: FileSystemProvider;
  private readonly platform: NodeJS.Platform;

  constructor(
    private readonly fs: FileSystemProvider,
    private readonly exec: IExecutionContext,
    options: { userFs?: FileSystemProvider; platform?: NodeJS.Platform } = {}
  ) {
    this.userFs = options.userFs ?? new LocalFileSystem(homedir());
    this.platform = options.platform ?? process.platform;
  }

  async writeClaudeHooks(): Promise<boolean> {
    if (!(await resolveCommandPath('claude', this.exec))) return false;

    const config: Record<string, unknown> = (await this.fs.exists(CLAUDE_SETTINGS_PATH))
      ? await this.fs
          .read(CLAUDE_SETTINGS_PATH)
          .then((r) => JSON.parse(r.content) ?? {})
          .catch(() => ({}))
      : {};

    const hooks = (config.hooks ?? {}) as Record<string, unknown[]>;

    const entriesByHookKey = new Map<string, HookEntryConfig[]>();
    for (const { eventType, hookKey, matcher, notificationType } of CLAUDE_HOOK_EVENT_MAP) {
      const command = notificationType
        ? makeNotificationHookCommand(notificationType, { platform: this.platform })
        : makeClaudeHookCommand(eventType, { platform: this.platform });
      const entries = entriesByHookKey.get(hookKey) ?? [];
      entries.push(matcher ? { command, matcher } : { command });
      entriesByHookKey.set(hookKey, entries);
    }

    for (const [hookKey, entries] of entriesByHookKey) {
      const existing = Array.isArray(hooks[hookKey]) ? hooks[hookKey] : [];
      hooks[hookKey] = this.buildHookEntries(existing, entries);
    }

    const permissionRequestHooks = hooks.PermissionRequest;
    if (Array.isArray(permissionRequestHooks)) {
      const userEntries = this.removeEmdashManagedEntries(permissionRequestHooks);
      if (userEntries.length > 0) {
        hooks.PermissionRequest = userEntries;
      } else {
        delete hooks.PermissionRequest;
      }
    }

    await this.fs.write(CLAUDE_SETTINGS_PATH, JSON.stringify({ ...config, hooks }, null, 2) + '\n');
    return true;
  }

  async writeCodexHooks(): Promise<boolean> {
    if (!(await resolveCommandPath('codex', this.exec))) return false;

    const config: Record<string, unknown> = (await this.userFs.exists(CODEX_HOOKS_PATH))
      ? await this.userFs
          .read(CODEX_HOOKS_PATH)
          .then((r) => JSON.parse(r.content) ?? {})
          .catch(() => ({}))
      : {};

    const hooks = (config.hooks ?? {}) as Record<string, unknown[]>;

    for (const { hookKey, notificationType } of CODEX_HOOK_EVENT_MAP) {
      const existing = Array.isArray(hooks[hookKey]) ? hooks[hookKey] : [];
      hooks[hookKey] = this.buildHookEntries(existing, {
        command: makeCodexHookCommand(notificationType, { platform: this.platform }),
      });
    }

    for (const { hookKey } of CODEX_SESSION_HOOK_EVENT_MAP) {
      const existing = Array.isArray(hooks[hookKey]) ? hooks[hookKey] : [];
      hooks[hookKey] = this.buildHookEntries(existing, {
        command: makeCodexSessionStartHookCommand({ platform: this.platform }),
      });
    }

    await this.userFs.write(CODEX_HOOKS_PATH, JSON.stringify({ ...config, hooks }, null, 2) + '\n');
    await this.removeLegacyCodexNotify().catch((err: Error) => {
      log.warn('CodexHooks: failed to remove legacy notify entry', { error: String(err) });
    });
    return true;
  }

  async writeDroidHooks(): Promise<boolean> {
    if (!(await resolveCommandPath('droid', this.exec))) return false;

    const config: Record<string, unknown> = (await this.fs.exists(DROID_SETTINGS_PATH))
      ? await this.fs
          .read(DROID_SETTINGS_PATH)
          .then((r) => JSON.parse(r.content) ?? {})
          .catch(() => ({}))
      : {};

    const hooks = (config.hooks ?? {}) as Record<string, unknown[]>;

    for (const { hookKey, eventType } of DROID_HOOK_EVENT_MAP) {
      const existing = Array.isArray(hooks[hookKey]) ? hooks[hookKey] : [];
      hooks[hookKey] = this.buildHookEntries(existing, {
        command: makeClaudeHookCommand(eventType, { platform: this.platform }),
      });
    }

    await this.fs.write(DROID_SETTINGS_PATH, JSON.stringify({ ...config, hooks }, null, 2) + '\n');
    return true;
  }

  async writePiExtension(): Promise<boolean> {
    if (!(await resolveCommandPath('pi', this.exec))) return false;

    const existing = await this.fs
      .read(PI_EMDASH_EXTENSION_PATH)
      .then((r) => r.content)
      .catch(() => undefined);
    if (existing === piEmdashExtension) return true;

    await this.fs.write(PI_EMDASH_EXTENSION_PATH, piEmdashExtension);
    return true;
  }

  async writeOpenCodePlugin(): Promise<boolean> {
    if (!(await resolveCommandPath('opencode', this.exec))) return false;

    const pluginContent = makeOpenCodePluginContent();
    const existing = await this.fs
      .read(OPENCODE_PLUGIN_PATH)
      .then((r) => r.content)
      .catch(() => undefined);
    if (existing === pluginContent) return true;

    await this.fs.write(OPENCODE_PLUGIN_PATH, pluginContent);
    return true;
  }

  async writeAmpPlugin(): Promise<boolean> {
    if (!(await resolveCommandPath('amp', this.exec))) return false;

    const pluginContent = makeAmpPluginContent();
    const existing = await this.fs
      .read(AMP_PLUGIN_PATH)
      .then((r) => r.content)
      .catch(() => undefined);
    if (existing === pluginContent) return true;

    await this.fs.write(AMP_PLUGIN_PATH, pluginContent);
    return true;
  }

  async writeForProvider(
    providerId: AgentProviderId,
    options: HookConfigWriteOptions = {}
  ): Promise<boolean> {
    const writeGitIgnoreEntries = options.writeGitIgnoreEntries ?? true;

    if (providerId === 'claude') {
      const wroteConfig = await this.writeClaudeHooks();
      if (wroteConfig && writeGitIgnoreEntries) {
        await this.ensureGitIgnoreEntries([CLAUDE_SETTINGS_PATH]);
      }
      return wroteConfig;
    }

    if (providerId === 'codex') {
      return this.writeCodexHooks();
    }

    if (providerId === 'droid') {
      const wroteConfig = await this.writeDroidHooks();
      if (wroteConfig && writeGitIgnoreEntries) {
        await this.ensureGitIgnoreEntries([DROID_SETTINGS_PATH]);
      }
      return wroteConfig;
    }

    if (providerId === 'pi') {
      const wroteConfig = await this.writePiExtension();
      if (wroteConfig && writeGitIgnoreEntries) {
        await this.ensureGitIgnoreEntries([PI_EMDASH_EXTENSION_PATH]);
      }
      return wroteConfig;
    }

    if (providerId === 'opencode') {
      const wroteConfig = await this.writeOpenCodePlugin();
      if (wroteConfig && writeGitIgnoreEntries) {
        await this.ensureGitIgnoreEntries([OPENCODE_PLUGIN_PATH]);
      }
      return wroteConfig;
    }

    if (providerId === 'amp') {
      const wroteConfig = await this.writeAmpPlugin();
      if (wroteConfig && writeGitIgnoreEntries) {
        await this.ensureGitIgnoreEntries([AMP_PLUGIN_PATH]);
      }
      return wroteConfig;
    }

    return false;
  }

  async writeAll(options: HookConfigWriteOptions = {}): Promise<void> {
    await Promise.all(
      (['claude', 'codex', 'droid', 'pi', 'opencode', 'amp'] as const).map((providerId) =>
        this.writeForProvider(providerId, options).catch((err: Error) => {
          log.warn(`Failed to write ${providerId} hook config`, { error: String(err) });
        })
      )
    );
  }

  private buildHookEntries(
    existing: unknown[],
    entries: HookEntryConfig | HookEntryConfig[]
  ): unknown[] {
    const userEntries = this.removeEmdashManagedEntries(existing);
    const hookEntryConfigs = Array.isArray(entries) ? entries : [entries];
    const hookEntries = hookEntryConfigs.map(({ command, matcher }) => ({
      ...(matcher ? { matcher } : {}),
      hooks: [{ type: 'command', command }],
    }));
    return [...userEntries, ...hookEntries];
  }

  private removeEmdashManagedEntries(existing: unknown[]): unknown[] {
    return existing.filter((entry) => !JSON.stringify(entry).includes(EMDASH_MARKER));
  }

  private async removeLegacyCodexNotify(): Promise<void> {
    if (!(await this.fs.exists(CODEX_CONFIG_PATH))) return;

    const config = await this.fs
      .read(CODEX_CONFIG_PATH)
      .then((result) => toml.parse(result.content) as Record<string, unknown>)
      .catch(() => undefined);
    if (!config || !this.isLegacyCodexNotify(config.notify)) return;

    delete config.notify;
    await this.fs.write(CODEX_CONFIG_PATH, toml.stringify(config));
  }

  private isLegacyCodexNotify(value: unknown): boolean {
    if (!Array.isArray(value)) return false;
    if (JSON.stringify(value) === JSON.stringify(LEGACY_CODEX_NOTIFY_COMMAND)) return true;

    const [command, noProfile, fileFlag, scriptPath] = value.map((item) => String(item));
    return (
      command.toLowerCase() === 'powershell.exe' &&
      noProfile === '-NoProfile' &&
      fileFlag === '-File' &&
      scriptPath.endsWith('emdash-codex-notify.ps1')
    );
  }

  private async ensureGitIgnoreEntries(entries: string[]): Promise<void> {
    const existingGitIgnore = await this.fs
      .read(GITIGNORE_PATH)
      .then((result) => result.content)
      .catch(() => '');

    const existingEntries = existingGitIgnore
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'));
    const missing = entries.filter((entry) => !this.isGitIgnored(existingEntries, entry));

    if (missing.length === 0) return;

    const content = existingGitIgnore.replace(/\s*$/, '');
    const next =
      content.length > 0 ? `${content}\n${missing.join('\n')}\n` : `${missing.join('\n')}\n`;
    await this.fs.write(GITIGNORE_PATH, next);
  }

  private isGitIgnored(existingEntries: string[], entry: string): boolean {
    const normalizedEntry = entry.replace(/^\/+/, '');
    return existingEntries.some((rawPattern) => {
      const pattern = rawPattern.replace(/^\/+/, '');
      if (pattern === normalizedEntry) return true;

      if (pattern.endsWith('/')) {
        return normalizedEntry.startsWith(pattern);
      }

      if (pattern.endsWith('/**')) {
        const prefix = pattern.slice(0, -2);
        return normalizedEntry.startsWith(prefix);
      }

      return false;
    });
  }
}
