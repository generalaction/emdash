import { homedir } from 'node:os';
import * as toml from 'smol-toml';
import { resolveCommandPath } from '@main/core/dependencies/probe';
import type { IExecutionContext } from '@main/core/execution-context/types';
import { LocalFileSystem } from '@main/core/fs/impl/local-fs';
import type { FileSystemProvider } from '@main/core/fs/types';
import { log } from '@main/lib/logger';
import type { AgentProviderId } from '@shared/core/agents/agent-provider-registry';
import {
  makeAmpPluginContent,
  makeClaudeHookCommand,
  makeCodexHookCommand,
  makeCodexSessionStartHookCommand,
  makeGeminiHookCommand,
  makeGrokSessionStartHookCommand,
  makeOpenCodePluginContent,
} from './agent-notify-command';
import piEmdashExtension from './pi-emdash-extension.ts?raw';

const EMDASH_MARKER = 'EMDASH_HOOK_PORT';

const CLAUDE_SETTINGS_PATH = '.claude/settings.local.json';
const DEVIN_HOOKS_PATH = '.devin/hooks.v1.json';
const CODEX_CONFIG_PATH = '.codex/config.toml';
const CODEX_HOOKS_PATH = '.codex/hooks.json';
const KIMI_CONFIG_PATH = '.kimi-code/config.toml';
const LEGACY_KIMI_CONFIG_PATH = '.kimi/config.toml';
const GROK_HOOKS_PATH = '.grok/hooks/emdash.json';
const COPILOT_HOOKS_PATH = '.github/hooks/emdash.json';
const QWEN_SETTINGS_PATH = '.qwen/settings.json';
const GEMINI_SETTINGS_PATH = '.gemini/settings.json';
const DROID_SETTINGS_PATH = '.factory/settings.json';
const AMP_PLUGIN_PATH = '.amp/plugins/emdash-hook.ts';
const PI_EMDASH_EXTENSION_PATH = '.pi/extensions/emdash-hook.ts';
const OPENCODE_PLUGIN_PATH = '.opencode/plugins/emdash-notifications.js';
const KIRO_AGENT_CONFIG_PATH = '.kiro/agents/emdash.json';
const GITIGNORE_PATH = '.gitignore';
type HookConfigWriteOptions = { writeGitIgnoreEntries?: boolean };
type CodexHookEvent = 'Stop' | 'PermissionRequest' | 'SessionStart';
type KimiHookEvent =
  | 'Notification'
  | 'PostToolUse'
  | 'PostToolUseFailure'
  | 'SessionEnd'
  | 'SessionStart'
  | 'Stop'
  | 'StopFailure'
  | 'UserPromptSubmit';
type CopilotHookEvent = 'agentStop' | 'notification' | 'permissionRequest' | 'sessionStart';
type GrokHookEvent =
  | 'Notification'
  | 'PostToolUse'
  | 'PostToolUseFailure'
  | 'PreToolUse'
  | 'SessionEnd'
  | 'SessionStart'
  | 'Stop'
  | 'StopFailure'
  | 'UserPromptSubmit';
type QwenHookEvent = 'PermissionRequest' | 'SessionEnd' | 'Stop';
type GeminiHookEvent =
  | 'AfterAgent'
  | 'BeforeAgent'
  | 'Notification'
  | 'SessionEnd'
  | 'SessionStart';
type DroidHookEvent = 'Notification' | 'Stop' | 'SessionStart';
type DevinHookEvent = 'PermissionRequest' | 'SessionEnd' | 'Stop';
type KiroHookEvent = 'agentSpawn' | 'userPromptSubmit' | 'preToolUse' | 'postToolUse' | 'stop';

const HOOK_EVENT_MAP = [
  { eventType: 'notification', hookKey: 'Notification' },
  { eventType: 'stop', hookKey: 'Stop' },
] satisfies { eventType: string; hookKey: string }[];

const CODEX_HOOK_EVENT_MAP = [
  { hookKey: 'Stop', notificationType: 'idle_prompt' },
  { hookKey: 'PermissionRequest', notificationType: 'permission_prompt' },
] satisfies { hookKey: CodexHookEvent; notificationType: 'idle_prompt' | 'permission_prompt' }[];

const CODEX_SESSION_HOOK_EVENT_MAP = [{ hookKey: 'SessionStart' as const }] satisfies {
  hookKey: CodexHookEvent;
}[];

const KIMI_HOOK_EVENT_MAP = [
  { hookKey: 'SessionStart', eventType: 'session' },
  { hookKey: 'UserPromptSubmit', eventType: 'start' },
  { hookKey: 'PostToolUse', eventType: 'start' },
  { hookKey: 'PostToolUseFailure', eventType: 'start' },
  { hookKey: 'Notification', eventType: 'notification' },
  { hookKey: 'Stop', eventType: 'stop' },
  { hookKey: 'StopFailure', eventType: 'stop' },
  { hookKey: 'SessionEnd', eventType: 'stop' },
] satisfies { hookKey: KimiHookEvent; eventType: 'notification' | 'session' | 'start' | 'stop' }[];

const COPILOT_HOOK_EVENT_MAP = [{ hookKey: 'agentStop', eventType: 'stop' }] satisfies {
  hookKey: CopilotHookEvent;
  eventType: 'stop';
}[];

const COPILOT_SESSION_HOOK_EVENT_MAP = [{ hookKey: 'sessionStart' as const }] satisfies {
  hookKey: CopilotHookEvent;
}[];

const DROID_HOOK_EVENT_MAP = [
  { hookKey: 'Notification', eventType: 'notification' },
  { hookKey: 'Stop', eventType: 'stop' },
  { hookKey: 'SessionStart', eventType: 'session' },
] satisfies { hookKey: DroidHookEvent; eventType: 'notification' | 'stop' | 'session' }[];

const DEVIN_HOOK_EVENT_MAP = [
  { hookKey: 'Stop', eventType: 'stop' },
  { hookKey: 'SessionEnd', eventType: 'stop' },
] satisfies { hookKey: DevinHookEvent; eventType: 'stop' }[];

const KIRO_HOOK_EVENT_MAP = [
  { hookKey: 'agentSpawn', eventType: 'session' },
  { hookKey: 'userPromptSubmit', eventType: 'start' },
  { hookKey: 'preToolUse', eventType: 'start' },
  { hookKey: 'postToolUse', eventType: 'start' },
  { hookKey: 'stop', eventType: 'stop' },
] satisfies { hookKey: KiroHookEvent; eventType: 'session' | 'start' | 'stop' }[];

function buildKimiHookEntries(existing: unknown[], platform: NodeJS.Platform): unknown[] {
  const userEntries = existing.filter((entry) => !JSON.stringify(entry).includes(EMDASH_MARKER));
  const emdashEntries = KIMI_HOOK_EVENT_MAP.map(({ hookKey, eventType }) => ({
    event: hookKey,
    command: makeClaudeHookCommand(eventType, { platform }),
  }));
  return [...userEntries, ...emdashEntries];
}

export function addKimiHooksToConfigText(
  content: string,
  options: { platform?: NodeJS.Platform } = {}
): string {
  const platform = options.platform ?? process.platform;
  try {
    const config = JSON.parse(content) as Record<string, unknown>;
    const hooks = Array.isArray(config.hooks) ? config.hooks : [];
    config.hooks = buildKimiHookEntries(hooks, platform);
    return JSON.stringify(config);
  } catch {}

  try {
    const config = toml.parse(content) as Record<string, unknown>;
    const hooks = Array.isArray(config.hooks) ? config.hooks : [];
    config.hooks = buildKimiHookEntries(hooks, platform);
    return toml.stringify(config);
  } catch {
    return content;
  }
}

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

    for (const { hookKey } of CODEX_SESSION_HOOK_EVENT_MAP) {
      const existing = Array.isArray(hooks[hookKey]) ? hooks[hookKey] : [];
      hooks[hookKey] = this.buildHookEntries(
        existing,
        makeCodexSessionStartHookCommand({ platform: this.platform })
      );
    }

    await this.userFs.write(CODEX_HOOKS_PATH, JSON.stringify({ ...config, hooks }, null, 2) + '\n');
    await this.removeLegacyCodexNotify().catch((err: Error) => {
      log.warn('CodexHooks: failed to remove legacy notify entry', { error: String(err) });
    });
    return true;
  }

  async writeCopilotHooks(): Promise<boolean> {
    if (!(await resolveCommandPath('copilot', this.exec))) return false;

    const config: Record<string, unknown> = (await this.fs.exists(COPILOT_HOOKS_PATH))
      ? await this.fs
          .read(COPILOT_HOOKS_PATH)
          .then((r) => JSON.parse(r.content) ?? {})
          .catch(() => ({}))
      : {};

    const hooks = (config.hooks ?? {}) as Record<string, unknown[]>;

    const existingNotification = Array.isArray(hooks.notification) ? hooks.notification : [];
    hooks.notification = existingNotification.filter(
      (entry) => !JSON.stringify(entry).includes(EMDASH_MARKER)
    );

    for (const { hookKey, eventType } of COPILOT_HOOK_EVENT_MAP) {
      const existing = Array.isArray(hooks[hookKey]) ? hooks[hookKey] : [];
      hooks[hookKey] = this.buildCopilotHookEntries(
        existing,
        makeClaudeHookCommand(eventType, { platform: this.platform })
      );
    }

    for (const { hookKey } of COPILOT_SESSION_HOOK_EVENT_MAP) {
      const existing = Array.isArray(hooks[hookKey]) ? hooks[hookKey] : [];
      hooks[hookKey] = this.buildCopilotHookEntries(
        existing,
        makeClaudeHookCommand('session', { platform: this.platform })
      );
    }

    const existingPermissionRequest = Array.isArray(hooks.permissionRequest)
      ? hooks.permissionRequest
      : [];
    hooks.permissionRequest = this.buildCopilotHookEntries(
      existingPermissionRequest,
      makeCodexHookCommand('permission_prompt', { platform: this.platform })
    );

    await this.fs.write(
      COPILOT_HOOKS_PATH,
      JSON.stringify({ ...config, version: 1, hooks }, null, 2) + '\n'
    );
    return true;
  }

  async writeGrokHooks(): Promise<boolean> {
    if (!(await resolveCommandPath('grok', this.exec))) return false;

    const config: Record<string, unknown> = (await this.userFs.exists(GROK_HOOKS_PATH))
      ? await this.userFs
          .read(GROK_HOOKS_PATH)
          .then((r) => JSON.parse(r.content) ?? {})
          .catch(() => ({}))
      : {};

    const hooks = (config.hooks ?? {}) as Record<string, unknown[]>;
    const hookEntries = [
      {
        hookKey: 'SessionStart',
        command: makeGrokSessionStartHookCommand({ platform: this.platform }),
      },
      {
        hookKey: 'UserPromptSubmit',
        command: makeClaudeHookCommand('start', { platform: this.platform }),
      },
      {
        hookKey: 'PreToolUse',
        command: makeClaudeHookCommand('start', { platform: this.platform }),
      },
      {
        hookKey: 'PostToolUse',
        command: makeClaudeHookCommand('start', { platform: this.platform }),
      },
      {
        hookKey: 'PostToolUseFailure',
        command: makeClaudeHookCommand('start', { platform: this.platform }),
      },
      {
        hookKey: 'Notification',
        command: makeClaudeHookCommand('notification', { platform: this.platform }),
      },
      { hookKey: 'Stop', command: makeClaudeHookCommand('stop', { platform: this.platform }) },
      {
        hookKey: 'StopFailure',
        command: makeClaudeHookCommand('stop', { platform: this.platform }),
      },
      {
        hookKey: 'SessionEnd',
        command: makeClaudeHookCommand('stop', { platform: this.platform }),
      },
    ] satisfies { hookKey: GrokHookEvent; command: string }[];

    for (const { hookKey, command } of hookEntries) {
      const existing = Array.isArray(hooks[hookKey]) ? hooks[hookKey] : [];
      hooks[hookKey] = this.buildHookEntries(existing, command);
    }

    await this.userFs.write(GROK_HOOKS_PATH, JSON.stringify({ ...config, hooks }, null, 2) + '\n');
    return true;
  }

  async writeKimiHooks(): Promise<boolean> {
    const wroteConfig = await this.writeKimiHookConfig(KIMI_CONFIG_PATH);
    const wroteLegacyConfig = await this.writeKimiHookConfig(LEGACY_KIMI_CONFIG_PATH);
    return wroteConfig || wroteLegacyConfig;
  }

  private async writeKimiHookConfig(path: string): Promise<boolean> {
    let config: Record<string, unknown> = {};
    if (await this.userFs.exists(path)) {
      try {
        const file = await this.userFs.read(path);
        config = toml.parse(file.content) as Record<string, unknown>;
      } catch (error) {
        log.warn('KimiHooks: failed to parse config; leaving it unchanged', {
          path,
          error: String(error),
        });
        return false;
      }
    }

    const hooks = Array.isArray(config.hooks) ? config.hooks : [];
    config.hooks = buildKimiHookEntries(hooks, this.platform);

    await this.userFs.write(path, toml.stringify(config));
    return true;
  }

  async writeQwenHooks(): Promise<boolean> {
    if (!(await resolveCommandPath('qwen', this.exec))) return false;

    const config: Record<string, unknown> = (await this.fs.exists(QWEN_SETTINGS_PATH))
      ? await this.fs
          .read(QWEN_SETTINGS_PATH)
          .then((r) => JSON.parse(r.content) ?? {})
          .catch(() => ({}))
      : {};

    const hooks = (config.hooks ?? {}) as Record<string, unknown[]>;
    const hookEntries = [
      {
        hookKey: 'PermissionRequest',
        command: makeClaudeHookCommand('notification', { platform: this.platform }),
      },
      { hookKey: 'Stop', command: makeClaudeHookCommand('stop', { platform: this.platform }) },
      {
        hookKey: 'SessionEnd',
        command: makeClaudeHookCommand('stop', { platform: this.platform }),
      },
    ] satisfies { hookKey: QwenHookEvent; command: string }[];

    for (const { hookKey, command } of hookEntries) {
      const existing = Array.isArray(hooks[hookKey]) ? hooks[hookKey] : [];
      hooks[hookKey] = this.buildHookEntries(existing, command);
    }

    await this.fs.write(QWEN_SETTINGS_PATH, JSON.stringify({ ...config, hooks }, null, 2) + '\n');
    return true;
  }

  async writeGeminiHooks(): Promise<boolean> {
    if (!(await resolveCommandPath('gemini', this.exec))) return false;

    const config: Record<string, unknown> = (await this.fs.exists(GEMINI_SETTINGS_PATH))
      ? await this.fs
          .read(GEMINI_SETTINGS_PATH)
          .then((r) => JSON.parse(r.content) ?? {})
          .catch(() => ({}))
      : {};

    const hooks = (config.hooks ?? {}) as Record<string, unknown[]>;
    const hookEntries = [
      { hookKey: 'SessionStart', eventType: 'session' },
      { hookKey: 'BeforeAgent', eventType: 'start' },
      { hookKey: 'Notification', eventType: 'notification' },
      { hookKey: 'AfterAgent', eventType: 'stop' },
      { hookKey: 'SessionEnd', eventType: 'stop' },
    ] satisfies {
      hookKey: GeminiHookEvent;
      eventType: 'notification' | 'session' | 'start' | 'stop';
    }[];

    for (const { hookKey, eventType } of hookEntries) {
      const existing = Array.isArray(hooks[hookKey]) ? hooks[hookKey] : [];
      hooks[hookKey] = this.buildGeminiHookEntries(
        existing,
        makeGeminiHookCommand(eventType, { platform: this.platform })
      );
    }

    await this.fs.write(GEMINI_SETTINGS_PATH, JSON.stringify({ ...config, hooks }, null, 2) + '\n');
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
      hooks[hookKey] = this.buildHookEntries(
        existing,
        makeClaudeHookCommand(eventType, { platform: this.platform })
      );
    }

    await this.fs.write(DROID_SETTINGS_PATH, JSON.stringify({ ...config, hooks }, null, 2) + '\n');
    return true;
  }

  async writeDevinHooks(): Promise<boolean> {
    if (!(await resolveCommandPath('devin', this.exec))) return false;

    const hooks: Record<string, unknown[]> = (await this.fs.exists(DEVIN_HOOKS_PATH))
      ? await this.fs
          .read(DEVIN_HOOKS_PATH)
          .then((r) => JSON.parse(r.content) ?? {})
          .catch(() => ({}))
      : {};

    for (const { hookKey, eventType } of DEVIN_HOOK_EVENT_MAP) {
      const existing = Array.isArray(hooks[hookKey]) ? hooks[hookKey] : [];
      hooks[hookKey] = this.buildHookEntries(
        existing,
        makeClaudeHookCommand(eventType, { platform: this.platform })
      );
    }

    const existingPermissionRequest = Array.isArray(hooks.PermissionRequest)
      ? hooks.PermissionRequest
      : [];
    hooks.PermissionRequest = this.buildHookEntries(
      existingPermissionRequest,
      makeCodexHookCommand('permission_prompt', { platform: this.platform })
    );

    await this.fs.write(DEVIN_HOOKS_PATH, JSON.stringify(hooks, null, 2) + '\n');
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

  async writeKiroHooks(): Promise<boolean> {
    if (!(await resolveCommandPath('kiro-cli', this.exec))) return false;

    const config: Record<string, unknown> = (await this.fs.exists(KIRO_AGENT_CONFIG_PATH))
      ? await this.fs
          .read(KIRO_AGENT_CONFIG_PATH)
          .then((r) => JSON.parse(r.content) ?? {})
          .catch(() => ({}))
      : {};

    const hooks = (config.hooks ?? {}) as Record<string, unknown[]>;

    for (const { hookKey, eventType } of KIRO_HOOK_EVENT_MAP) {
      const existing = Array.isArray(hooks[hookKey]) ? hooks[hookKey] : [];
      hooks[hookKey] = this.buildKiroHookEntries(
        existing,
        makeClaudeHookCommand(eventType, { platform: this.platform })
      );
    }

    await this.fs.write(
      KIRO_AGENT_CONFIG_PATH,
      JSON.stringify(
        {
          ...config,
          name: 'emdash',
          description: 'Emdash-managed Kiro agent configuration for lifecycle hooks.',
          hooks,
        },
        null,
        2
      ) + '\n'
    );
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

    if (providerId === 'grok') {
      return this.writeGrokHooks();
    }

    if (providerId === 'kimi') {
      return this.writeKimiHooks();
    }

    if (providerId === 'copilot') {
      const wroteConfig = await this.writeCopilotHooks();
      if (wroteConfig && writeGitIgnoreEntries) {
        await this.ensureGitIgnoreEntries([COPILOT_HOOKS_PATH]);
      }
      return wroteConfig;
    }

    if (providerId === 'qwen') {
      const wroteConfig = await this.writeQwenHooks();
      if (wroteConfig && writeGitIgnoreEntries) {
        await this.ensureGitIgnoreEntries([QWEN_SETTINGS_PATH]);
      }
      return wroteConfig;
    }

    if (providerId === 'gemini') {
      const wroteConfig = await this.writeGeminiHooks();
      if (wroteConfig && writeGitIgnoreEntries) {
        await this.ensureGitIgnoreEntries([GEMINI_SETTINGS_PATH]);
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

    if (providerId === 'devin') {
      const wroteConfig = await this.writeDevinHooks();
      if (wroteConfig && writeGitIgnoreEntries) {
        await this.ensureGitIgnoreEntries([DEVIN_HOOKS_PATH]);
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

    if (providerId === 'kiro') {
      const wroteConfig = await this.writeKiroHooks();
      if (wroteConfig && writeGitIgnoreEntries) {
        await this.ensureGitIgnoreEntries([KIRO_AGENT_CONFIG_PATH]);
      }
      return wroteConfig;
    }

    return false;
  }

  async writeAll(options: HookConfigWriteOptions = {}): Promise<void> {
    await Promise.all(
      (
        [
          'claude',
          'codex',
          'grok',
          'kimi',
          'copilot',
          'qwen',
          'gemini',
          'devin',
          'droid',
          'pi',
          'opencode',
          'amp',
          'kiro',
        ] as const
      ).map((providerId) =>
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

  private buildCopilotHookEntries(existing: unknown[], command: string): unknown[] {
    const userEntries = existing.filter((entry) => !JSON.stringify(entry).includes(EMDASH_MARKER));
    return [...userEntries, { type: 'command', command }];
  }

  private buildKiroHookEntries(existing: unknown[], command: string): unknown[] {
    const userEntries = existing.filter((entry) => !JSON.stringify(entry).includes(EMDASH_MARKER));
    return [...userEntries, { command }];
  }

  private buildGeminiHookEntries(existing: unknown[], command: string): unknown[] {
    const userEntries = existing.filter((entry) => !JSON.stringify(entry).includes(EMDASH_MARKER));
    return [
      ...userEntries,
      {
        matcher: '*',
        hooks: [
          {
            name: 'emdash-notify',
            type: 'command',
            command,
            timeout: 5000,
          },
        ],
      },
    ];
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
