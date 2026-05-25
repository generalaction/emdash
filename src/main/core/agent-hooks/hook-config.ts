import { homedir } from 'node:os';
import * as toml from 'smol-toml';
import { resolveCommandPath } from '@main/core/dependencies/probe';
import type { IExecutionContext } from '@main/core/execution-context/types';
import { LocalFileSystem } from '@main/core/fs/impl/local-fs';
import type { FileSystemProvider } from '@main/core/fs/types';
import { log } from '@main/lib/logger';
import type { AgentProviderId } from '@shared/agent-provider-registry';
import {
  makeClaudeHookCommand,
  makeCodexHookCommand,
  makeOpenCodePluginContent,
} from './agent-notify-command';
import cursorEmdashHookScript from './cursor-emdash-hook.cjs?raw';
import piEmdashExtension from './pi-emdash-extension.ts?raw';

const EMDASH_MARKER = 'EMDASH_HOOK_PORT';

const CLAUDE_SETTINGS_PATH = '.claude/settings.local.json';
const CODEX_CONFIG_PATH = '.codex/config.toml';
const CODEX_HOOKS_PATH = '.codex/hooks.json';
const DROID_SETTINGS_PATH = '.factory/settings.json';
const PI_EMDASH_EXTENSION_PATH = '.pi/extensions/emdash-hook.ts';
const OPENCODE_PLUGIN_PATH = '.opencode/plugins/emdash-notifications.js';
const CURSOR_HOOKS_PATH = '.cursor/hooks.json';
const CURSOR_HOOK_SCRIPT_PATH = '.cursor/hooks/emdash-notify.cjs';
export const CURSOR_HOOK_SESSION_PATH = '.cursor/emdash-hook-session.json';
const GITIGNORE_PATH = '.gitignore';
type HookConfigWriteOptions = { writeGitIgnoreEntries?: boolean };
type CodexHookEvent = 'Stop' | 'PermissionRequest';
type CursorHookEvent =
  | 'stop'
  | 'beforeSubmitPrompt'
  | 'afterAgentThought'
  | 'preToolUse'
  | 'beforeShellExecution'
  | 'beforeMCPExecution';
type DroidHookEvent = 'Notification' | 'Stop';

const HOOK_EVENT_MAP = [
  { eventType: 'notification', hookKey: 'Notification' },
  { eventType: 'stop', hookKey: 'Stop' },
] satisfies { eventType: string; hookKey: string }[];

const CODEX_HOOK_EVENT_MAP = [
  { hookKey: 'Stop', notificationType: 'idle_prompt' },
  { hookKey: 'PermissionRequest', notificationType: 'permission_prompt' },
] satisfies { hookKey: CodexHookEvent; notificationType: 'idle_prompt' | 'permission_prompt' }[];

const DROID_HOOK_EVENT_MAP = [
  { hookKey: 'Notification', eventType: 'notification' },
  { hookKey: 'Stop', eventType: 'stop' },
] satisfies { hookKey: DroidHookEvent; eventType: 'notification' | 'stop' }[];

// Only `stop` signals agent completion. Mid-run events (postToolUse, afterFileEdit, …)
// fire after every tool call and must not mark the conversation idle.
const CURSOR_HOOK_EVENT_MAP = [
  { hookKey: 'stop', eventArg: 'stop' },
  { hookKey: 'beforeSubmitPrompt', eventArg: 'start' },
  { hookKey: 'afterAgentThought', eventArg: 'start' },
  { hookKey: 'preToolUse', eventArg: 'start' },
  { hookKey: 'beforeShellExecution', eventArg: 'permission' },
  { hookKey: 'beforeMCPExecution', eventArg: 'permission' },
] satisfies { hookKey: CursorHookEvent; eventArg: 'stop' | 'start' | 'permission' }[];

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

    for (const { eventType, hookKey } of HOOK_EVENT_MAP) {
      const existing = Array.isArray(hooks[hookKey]) ? hooks[hookKey] : [];
      hooks[hookKey] = this.buildHookEntries(
        existing,
        makeClaudeHookCommand(eventType, { platform: this.platform })
      );
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
      hooks[hookKey] = this.buildHookEntries(
        existing,
        makeCodexHookCommand(notificationType, { platform: this.platform })
      );
    }

    await this.userFs.write(CODEX_HOOKS_PATH, JSON.stringify({ ...config, hooks }, null, 2) + '\n');
    await this.removeLegacyCodexNotify().catch((err: Error) => {
      log.warn('CodexHooks: failed to remove legacy notify entry', { error: String(err) });
    });
    return true;
  }

  async writeCursorHooks(): Promise<boolean> {
    if (!(await this.isCursorCliAvailable())) return false;

    await this.ensureCursorHookScript();

    const config: Record<string, unknown> = (await this.fs.exists(CURSOR_HOOKS_PATH))
      ? await this.fs
          .read(CURSOR_HOOKS_PATH)
          .then((r) => JSON.parse(r.content) ?? {})
          .catch(() => ({}))
      : { version: 1 };

    const hooks = (config.hooks ?? {}) as Record<string, unknown[]>;
    const nodeCommand = await this.resolveCursorHookNodeCommand();

    for (const hookKey of Object.keys(hooks)) {
      if (!Array.isArray(hooks[hookKey])) continue;
      hooks[hookKey] = hooks[hookKey].filter(
        (entry) => !this.isEmdashManagedCursorHookEntry(entry)
      );
    }

    for (const { hookKey, eventArg } of CURSOR_HOOK_EVENT_MAP) {
      const existing = Array.isArray(hooks[hookKey]) ? hooks[hookKey] : [];
      hooks[hookKey] = this.buildCursorHookEntries(
        existing,
        `${nodeCommand} ${CURSOR_HOOK_SCRIPT_PATH} ${eventArg}`
      );
    }

    await this.removeLegacyCursorHookScript();

    await this.fs.write(
      CURSOR_HOOKS_PATH,
      JSON.stringify({ ...config, version: config.version ?? 1, hooks }, null, 2) + '\n'
    );
    return true;
  }

  async writeCursorHookSession(session: {
    port: number;
    token: string;
    ptyId: string;
    autoApprove?: boolean;
  }): Promise<void> {
    const existing = await this.fs
      .read(CURSOR_HOOK_SESSION_PATH)
      .then((r) => JSON.parse(r.content) as Record<string, unknown>)
      .catch((): Record<string, unknown> => ({}));
    const existingPtySessions =
      existing.ptySessions && typeof existing.ptySessions === 'object'
        ? (existing.ptySessions as Record<string, unknown>)
        : {};
    const existingCursorConversations =
      existing.cursorConversations && typeof existing.cursorConversations === 'object'
        ? (existing.cursorConversations as Record<string, unknown>)
        : {};

    await this.fs.write(
      CURSOR_HOOK_SESSION_PATH,
      JSON.stringify({
        port: session.port,
        token: session.token,
        activePtyId: session.ptyId,
        ptySessions: {
          ...existingPtySessions,
          [session.ptyId]: { autoApprove: session.autoApprove === true },
        },
        cursorConversations: existingCursorConversations,
      }) + '\n'
    );
  }

  private async ensureCursorHookScript(): Promise<void> {
    let existingScript: string | undefined;
    if (await this.fs.exists(CURSOR_HOOK_SCRIPT_PATH)) {
      existingScript = (await this.fs.read(CURSOR_HOOK_SCRIPT_PATH)).content;
    }
    if (existingScript === cursorEmdashHookScript) return;
    await this.fs.write(CURSOR_HOOK_SCRIPT_PATH, cursorEmdashHookScript);
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
      hooks[hookKey] = this.buildHookEntries(
        existing,
        makeClaudeHookCommand(eventType, { platform: this.platform })
      );
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

    if (providerId === 'cursor') {
      const wroteConfig = await this.writeCursorHooks();
      if (wroteConfig && writeGitIgnoreEntries) {
        await this.ensureGitIgnoreEntries([
          CURSOR_HOOKS_PATH,
          CURSOR_HOOK_SCRIPT_PATH,
          CURSOR_HOOK_SESSION_PATH,
        ]);
      }
      return wroteConfig;
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

    return false;
  }

  async writeAll(options: HookConfigWriteOptions = {}): Promise<void> {
    await Promise.all(
      (['claude', 'codex', 'cursor', 'droid', 'pi', 'opencode'] as const).map((providerId) =>
        this.writeForProvider(providerId, options).catch((err: Error) => {
          log.warn(`Failed to write ${providerId} hook config`, { error: String(err) });
        })
      )
    );
  }

  private buildHookEntries(existing: unknown[], command: string): unknown[] {
    const userEntries = existing.filter((entry) => !JSON.stringify(entry).includes(EMDASH_MARKER));
    return [...userEntries, { hooks: [{ type: 'command', command }] }];
  }

  private buildCursorHookEntries(existing: unknown[], command: string): unknown[] {
    const userEntries = existing.filter((entry) => !this.isEmdashManagedCursorHookEntry(entry));
    return [...userEntries, { command }];
  }

  private isEmdashManagedCursorHookEntry(entry: unknown): boolean {
    const serialized = JSON.stringify(entry);
    return (
      serialized.includes('emdash-notify') ||
      serialized.includes(EMDASH_MARKER) ||
      serialized.includes('EMDASH_HOOK_TOKEN') ||
      serialized.includes('EMDASH_PTY_ID') ||
      serialized.includes('/hook"')
    );
  }

  private async resolveCursorHookNodeCommand(): Promise<string> {
    const nodePath = await resolveCommandPath('node', this.exec);
    if (nodePath) return nodePath;
    const execPath = process.execPath.includes(' ') ? `"${process.execPath}"` : process.execPath;
    return `ELECTRON_RUN_AS_NODE=1 ${execPath}`;
  }

  private async removeLegacyCursorHookScript(): Promise<void> {
    const legacyPath = '.cursor/hooks/emdash-notify.sh';
    if (!(await this.fs.exists(legacyPath))) return;
    await this.fs.remove(legacyPath).catch(() => undefined);
  }

  private async isCursorCliAvailable(): Promise<boolean> {
    if (await resolveCommandPath('cursor-agent', this.exec)) return true;
    if (!(await this.fs.exists('.cursor'))) return false;
    return !!(await resolveCommandPath('agent', this.exec));
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
