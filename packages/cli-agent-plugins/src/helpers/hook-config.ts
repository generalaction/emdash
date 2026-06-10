import { parse as parseTOML, stringify as stringifyTOML } from 'smol-toml';
import type { HookRegistration } from '../core/capabilities';
import type { CLIAgentPluginFs } from '../core/plugin';
import {
  EMDASH_MARKER,
  filterUserHooks,
  makeClaudeHookCommand,
  makeCodexHookCommand,
  makeCodexSessionStartHookCommand,
  makeGrokSessionStartHookCommand,
  type HookCommandOptions,
} from './hooks';

export type { HookCommandOptions };

// ── Internal shape builders ─────────────────────────────────────────────────

/** Claude-style nested entry: `{ hooks: [{ type: 'command', command }] }` */
function buildClaudeEntry(command: string): Record<string, unknown> {
  return { hooks: [{ type: 'command', command }] };
}

/** Copilot-flat entry: `{ type: 'command', command }` */
function buildCopilotEntry(command: string): Record<string, unknown> {
  return { type: 'command', command };
}

/** Kiro entry: `{ command }` */
function buildKiroEntry(command: string): Record<string, unknown> {
  return { command };
}

function mergeClaudeEntries(existing: unknown[], command: string): unknown[] {
  return [...filterUserHooks(existing as Record<string, unknown>[]), buildClaudeEntry(command)];
}

function mergeCopilotEntries(existing: unknown[], command: string): unknown[] {
  return [...filterUserHooks(existing as Record<string, unknown>[]), buildCopilotEntry(command)];
}

function mergeKiroEntries(existing: unknown[], command: string): unknown[] {
  return [...filterUserHooks(existing as Record<string, unknown>[]), buildKiroEntry(command)];
}

// ── Helper: read/write JSON config ─────────────────────────────────────────

async function readJsonConfig(
  fs: CLIAgentPluginFs,
  path: string
): Promise<Record<string, unknown>> {
  const content = await fs.read(path);
  if (!content) return {};
  try {
    return (JSON.parse(content) as Record<string, unknown>) ?? {};
  } catch {
    return {};
  }
}

async function writeJsonConfig(
  fs: CLIAgentPluginFs,
  path: string,
  config: Record<string, unknown>
): Promise<void> {
  await fs.write(path, JSON.stringify(config, null, 2) + '\n');
}

// ── Claude / Claude-style hooks ─────────────────────────────────────────────

type ClaudeHookSpec = {
  hookKey: string;
  eventType: string;
  commandFn?: (eventType: string, opts: HookCommandOptions) => string;
};

/**
 * Build a hooks descriptor for Claude-style nested format:
 * `{ hooks: { <Event>: [{ hooks: [{ type: 'command', command }] }] } }`
 */
export function buildClaudeStyleHookConfig(
  configPath: string,
  hookSpecs: ClaudeHookSpec[],
  opts: HookCommandOptions = {}
) {
  return {
    async readHooks(fs: CLIAgentPluginFs): Promise<HookRegistration[]> {
      const config = await readJsonConfig(fs, configPath);
      const hooks = (config.hooks ?? {}) as Record<string, unknown[]>;
      const installed = hookSpecs.some(({ hookKey }) => {
        const entries = Array.isArray(hooks[hookKey]) ? hooks[hookKey] : [];
        return entries.some((e) => JSON.stringify(e).includes(EMDASH_MARKER));
      });
      return installed ? [{ event: 'emdash', command: EMDASH_MARKER }] : [];
    },
    async writeHooks(fs: CLIAgentPluginFs, _hooks: HookRegistration[]): Promise<void> {
      const config = await readJsonConfig(fs, configPath);
      const hooks = (config.hooks ?? {}) as Record<string, unknown[]>;
      for (const { hookKey, eventType, commandFn } of hookSpecs) {
        const cmd = commandFn ? commandFn(eventType, opts) : makeClaudeHookCommand(eventType, opts);
        const existing = Array.isArray(hooks[hookKey]) ? hooks[hookKey] : [];
        hooks[hookKey] = mergeClaudeEntries(existing, cmd);
      }
      await writeJsonConfig(fs, configPath, { ...config, hooks });
    },
    async deleteHooks(fs: CLIAgentPluginFs): Promise<void> {
      const config = await readJsonConfig(fs, configPath);
      const hooks = (config.hooks ?? {}) as Record<string, unknown[]>;
      for (const key of Object.keys(hooks)) {
        hooks[key] = filterUserHooks(hooks[key] as Record<string, unknown>[]);
      }
      await writeJsonConfig(fs, configPath, { ...config, hooks });
    },
    async getHooksInstalled(fs: CLIAgentPluginFs): Promise<boolean> {
      const config = await readJsonConfig(fs, configPath);
      const hooks = (config.hooks ?? {}) as Record<string, unknown[]>;
      return hookSpecs.some(({ hookKey }) => {
        const entries = Array.isArray(hooks[hookKey]) ? hooks[hookKey] : [];
        return entries.some((e) => JSON.stringify(e).includes(EMDASH_MARKER));
      });
    },
  };
}

// ── Codex hooks (JSON, global ~/.codex/hooks.json) ──────────────────────────

export const CODEX_HOOKS_PATH = '.codex/hooks.json';

export function buildCodexHookConfig(opts: HookCommandOptions = {}) {
  return {
    async readHooks(fs: CLIAgentPluginFs): Promise<HookRegistration[]> {
      const config = await readJsonConfig(fs, CODEX_HOOKS_PATH);
      const hooks = (config.hooks ?? {}) as Record<string, unknown[]>;
      const installed = ['Stop', 'PermissionRequest', 'SessionStart'].some((k) => {
        const entries = Array.isArray(hooks[k]) ? hooks[k] : [];
        return entries.some((e) => JSON.stringify(e).includes(EMDASH_MARKER));
      });
      return installed ? [{ event: 'emdash', command: EMDASH_MARKER }] : [];
    },
    async writeHooks(fs: CLIAgentPluginFs, _hooks: HookRegistration[]): Promise<void> {
      const config = await readJsonConfig(fs, CODEX_HOOKS_PATH);
      const hooks = (config.hooks ?? {}) as Record<string, unknown[]>;

      // Stop -> idle_prompt, PermissionRequest -> permission_prompt
      const notifySpecs = [
        { hookKey: 'Stop', notificationType: 'idle_prompt' as const },
        { hookKey: 'PermissionRequest', notificationType: 'permission_prompt' as const },
      ];
      for (const { hookKey, notificationType } of notifySpecs) {
        const existing = Array.isArray(hooks[hookKey]) ? hooks[hookKey] : [];
        hooks[hookKey] = mergeClaudeEntries(existing, makeCodexHookCommand(notificationType, opts));
      }
      // SessionStart
      const existing = Array.isArray(hooks.SessionStart) ? hooks.SessionStart : [];
      hooks.SessionStart = mergeClaudeEntries(existing, makeCodexSessionStartHookCommand(opts));

      await writeJsonConfig(fs, CODEX_HOOKS_PATH, { ...config, hooks });
    },
    async deleteHooks(fs: CLIAgentPluginFs): Promise<void> {
      const config = await readJsonConfig(fs, CODEX_HOOKS_PATH);
      const hooks = (config.hooks ?? {}) as Record<string, unknown[]>;
      for (const key of Object.keys(hooks)) {
        hooks[key] = filterUserHooks(hooks[key] as Record<string, unknown>[]);
      }
      await writeJsonConfig(fs, CODEX_HOOKS_PATH, { ...config, hooks });
    },
    async getHooksInstalled(fs: CLIAgentPluginFs): Promise<boolean> {
      const config = await readJsonConfig(fs, CODEX_HOOKS_PATH);
      const hooks = (config.hooks ?? {}) as Record<string, unknown[]>;
      return ['Stop', 'PermissionRequest', 'SessionStart'].some((k) => {
        const entries = Array.isArray(hooks[k]) ? hooks[k] : [];
        return entries.some((e) => JSON.stringify(e).includes(EMDASH_MARKER));
      });
    },
  };
}

// ── Grok hooks (JSON, global ~/.grok/hooks/emdash.json) ────────────────────

export const GROK_HOOKS_PATH = '.grok/hooks/emdash.json';

export function buildGrokHookConfig(opts: HookCommandOptions = {}) {
  const hookEntries = [
    { hookKey: 'SessionStart', commandFn: () => makeGrokSessionStartHookCommand(opts) },
    { hookKey: 'UserPromptSubmit', commandFn: () => makeClaudeHookCommand('start', opts) },
    { hookKey: 'PreToolUse', commandFn: () => makeClaudeHookCommand('start', opts) },
    { hookKey: 'PostToolUse', commandFn: () => makeClaudeHookCommand('start', opts) },
    { hookKey: 'PostToolUseFailure', commandFn: () => makeClaudeHookCommand('start', opts) },
    { hookKey: 'Notification', commandFn: () => makeClaudeHookCommand('notification', opts) },
    { hookKey: 'Stop', commandFn: () => makeClaudeHookCommand('stop', opts) },
    { hookKey: 'StopFailure', commandFn: () => makeClaudeHookCommand('stop', opts) },
    { hookKey: 'SessionEnd', commandFn: () => makeClaudeHookCommand('stop', opts) },
  ];

  return {
    async readHooks(fs: CLIAgentPluginFs): Promise<HookRegistration[]> {
      const config = await readJsonConfig(fs, GROK_HOOKS_PATH);
      const hooks = (config.hooks ?? {}) as Record<string, unknown[]>;
      const installed = hookEntries.some(({ hookKey }) => {
        const entries = Array.isArray(hooks[hookKey]) ? hooks[hookKey] : [];
        return entries.some((e) => JSON.stringify(e).includes(EMDASH_MARKER));
      });
      return installed ? [{ event: 'emdash', command: EMDASH_MARKER }] : [];
    },
    async writeHooks(fs: CLIAgentPluginFs, _hooks: HookRegistration[]): Promise<void> {
      const config = await readJsonConfig(fs, GROK_HOOKS_PATH);
      const hooks = (config.hooks ?? {}) as Record<string, unknown[]>;
      for (const { hookKey, commandFn } of hookEntries) {
        const existing = Array.isArray(hooks[hookKey]) ? hooks[hookKey] : [];
        hooks[hookKey] = mergeClaudeEntries(existing, commandFn());
      }
      await writeJsonConfig(fs, GROK_HOOKS_PATH, { ...config, hooks });
    },
    async deleteHooks(fs: CLIAgentPluginFs): Promise<void> {
      const config = await readJsonConfig(fs, GROK_HOOKS_PATH);
      const hooks = (config.hooks ?? {}) as Record<string, unknown[]>;
      for (const key of Object.keys(hooks)) {
        hooks[key] = filterUserHooks(hooks[key] as Record<string, unknown>[]);
      }
      await writeJsonConfig(fs, GROK_HOOKS_PATH, { ...config, hooks });
    },
    async getHooksInstalled(fs: CLIAgentPluginFs): Promise<boolean> {
      const config = await readJsonConfig(fs, GROK_HOOKS_PATH);
      const hooks = (config.hooks ?? {}) as Record<string, unknown[]>;
      return hookEntries.some(({ hookKey }) => {
        const entries = Array.isArray(hooks[hookKey]) ? hooks[hookKey] : [];
        return entries.some((e) => JSON.stringify(e).includes(EMDASH_MARKER));
      });
    },
  };
}

// ── Kimi hooks (TOML, global ~/.kimi-code/config.toml) ─────────────────────

export const KIMI_CONFIG_PATH = '.kimi-code/config.toml';
export const KIMI_LEGACY_CONFIG_PATH = '.kimi/config.toml';

type KimiHookSpec = { hookKey: string; eventType: string };

const KIMI_HOOK_SPECS: KimiHookSpec[] = [
  { hookKey: 'SessionStart', eventType: 'session' },
  { hookKey: 'UserPromptSubmit', eventType: 'start' },
  { hookKey: 'PostToolUse', eventType: 'start' },
  { hookKey: 'PostToolUseFailure', eventType: 'start' },
  { hookKey: 'Notification', eventType: 'notification' },
  { hookKey: 'Stop', eventType: 'stop' },
  { hookKey: 'StopFailure', eventType: 'stop' },
  { hookKey: 'SessionEnd', eventType: 'stop' },
];

function buildKimiHookEntries(existing: unknown[], opts: HookCommandOptions): unknown[] {
  const userEntries = filterUserHooks(existing as Record<string, unknown>[]);
  const emdashEntries = KIMI_HOOK_SPECS.map(({ hookKey, eventType }) => ({
    event: hookKey,
    command: makeClaudeHookCommand(eventType, opts),
  }));
  return [...userEntries, ...emdashEntries];
}

/**
 * Inject kimi hooks into an inline --config JSON/TOML text string.
 * Used by the kimi buildCommand to patch the --config= flag value on the fly.
 */
export function addKimiHooksToConfigText(content: string, opts: HookCommandOptions = {}): string {
  try {
    const config = JSON.parse(content) as Record<string, unknown>;
    const hooks = Array.isArray(config.hooks) ? config.hooks : [];
    config.hooks = buildKimiHookEntries(hooks, opts);
    return JSON.stringify(config);
  } catch {
    /* fall through to TOML */
  }
  try {
    const config = parseTOML(content) as Record<string, unknown>;
    const hooks = Array.isArray(config.hooks) ? config.hooks : [];
    config.hooks = buildKimiHookEntries(hooks, opts);
    return stringifyTOML(config);
  } catch {
    return content;
  }
}

async function writeKimiHookPath(
  fs: CLIAgentPluginFs,
  path: string,
  opts: HookCommandOptions
): Promise<boolean> {
  const content = await fs.read(path);
  let config: Record<string, unknown> = {};
  if (content) {
    try {
      config = parseTOML(content) as Record<string, unknown>;
    } catch {
      return false;
    }
  }
  const hooks = Array.isArray(config.hooks) ? config.hooks : [];
  config.hooks = buildKimiHookEntries(hooks, opts);
  await fs.write(path, stringifyTOML(config));
  return true;
}

export function buildKimiHookConfig(opts: HookCommandOptions = {}) {
  return {
    async readHooks(fs: CLIAgentPluginFs): Promise<HookRegistration[]> {
      for (const path of [KIMI_CONFIG_PATH, KIMI_LEGACY_CONFIG_PATH]) {
        const content = await fs.read(path);
        if (!content) continue;
        try {
          const config = parseTOML(content) as Record<string, unknown>;
          const hooks = Array.isArray(config.hooks) ? config.hooks : [];
          if (hooks.some((e) => JSON.stringify(e).includes(EMDASH_MARKER))) {
            return [{ event: 'emdash', command: EMDASH_MARKER }];
          }
        } catch {
          /* skip */
        }
      }
      return [];
    },
    async writeHooks(fs: CLIAgentPluginFs, _hooks: HookRegistration[]): Promise<void> {
      await writeKimiHookPath(fs, KIMI_CONFIG_PATH, opts);
      await writeKimiHookPath(fs, KIMI_LEGACY_CONFIG_PATH, opts);
    },
    async deleteHooks(fs: CLIAgentPluginFs): Promise<void> {
      for (const path of [KIMI_CONFIG_PATH, KIMI_LEGACY_CONFIG_PATH]) {
        const content = await fs.read(path);
        if (!content) continue;
        try {
          const config = parseTOML(content) as Record<string, unknown>;
          if (Array.isArray(config.hooks)) {
            config.hooks = filterUserHooks(config.hooks as Record<string, unknown>[]);
          }
          await fs.write(path, stringifyTOML(config));
        } catch {
          /* skip */
        }
      }
    },
    async getHooksInstalled(fs: CLIAgentPluginFs): Promise<boolean> {
      for (const path of [KIMI_CONFIG_PATH, KIMI_LEGACY_CONFIG_PATH]) {
        const content = await fs.read(path);
        if (!content) continue;
        try {
          const config = parseTOML(content) as Record<string, unknown>;
          const hooks = Array.isArray(config.hooks) ? config.hooks : [];
          if (hooks.some((e) => JSON.stringify(e).includes(EMDASH_MARKER))) return true;
        } catch {
          /* skip */
        }
      }
      return false;
    },
  };
}

// ── Copilot hooks (JSON, workspace .github/hooks/emdash.json) ──────────────

export const COPILOT_HOOKS_PATH = '.github/hooks/emdash.json';

export function buildCopilotHookConfig(opts: HookCommandOptions = {}) {
  return {
    async readHooks(fs: CLIAgentPluginFs): Promise<HookRegistration[]> {
      const config = await readJsonConfig(fs, COPILOT_HOOKS_PATH);
      const hooks = (config.hooks ?? {}) as Record<string, unknown[]>;
      const installed = ['agentStop', 'sessionStart', 'permissionRequest'].some((k) => {
        const entries = Array.isArray(hooks[k]) ? hooks[k] : [];
        return entries.some((e) => JSON.stringify(e).includes(EMDASH_MARKER));
      });
      return installed ? [{ event: 'emdash', command: EMDASH_MARKER }] : [];
    },
    async writeHooks(fs: CLIAgentPluginFs, _hooks: HookRegistration[]): Promise<void> {
      const config = await readJsonConfig(fs, COPILOT_HOOKS_PATH);
      const hooks = (config.hooks ?? {}) as Record<string, unknown[]>;

      // agentStop -> stop
      const stopExisting = Array.isArray(hooks.agentStop) ? hooks.agentStop : [];
      hooks.agentStop = mergeCopilotEntries(stopExisting, makeClaudeHookCommand('stop', opts));
      // sessionStart -> session
      const sessionExisting = Array.isArray(hooks.sessionStart) ? hooks.sessionStart : [];
      hooks.sessionStart = mergeCopilotEntries(
        sessionExisting,
        makeClaudeHookCommand('session', opts)
      );
      // permissionRequest -> permission_prompt notification
      const permExisting = Array.isArray(hooks.permissionRequest) ? hooks.permissionRequest : [];
      hooks.permissionRequest = mergeCopilotEntries(
        permExisting,
        makeCodexHookCommand('permission_prompt', opts)
      );
      // Clear any stale notification entries
      if (Array.isArray(hooks.notification)) {
        hooks.notification = filterUserHooks(hooks.notification as Record<string, unknown>[]);
      }

      await writeJsonConfig(fs, COPILOT_HOOKS_PATH, { ...config, version: 1, hooks });
    },
    async deleteHooks(fs: CLIAgentPluginFs): Promise<void> {
      const config = await readJsonConfig(fs, COPILOT_HOOKS_PATH);
      const hooks = (config.hooks ?? {}) as Record<string, unknown[]>;
      for (const key of Object.keys(hooks)) {
        hooks[key] = filterUserHooks(hooks[key] as Record<string, unknown>[]);
      }
      await writeJsonConfig(fs, COPILOT_HOOKS_PATH, { ...config, hooks });
    },
    async getHooksInstalled(fs: CLIAgentPluginFs): Promise<boolean> {
      const config = await readJsonConfig(fs, COPILOT_HOOKS_PATH);
      const hooks = (config.hooks ?? {}) as Record<string, unknown[]>;
      return ['agentStop', 'sessionStart', 'permissionRequest'].some((k) => {
        const entries = Array.isArray(hooks[k]) ? hooks[k] : [];
        return entries.some((e) => JSON.stringify(e).includes(EMDASH_MARKER));
      });
    },
  };
}

// ── Kiro hooks (JSON, workspace .kiro/agents/emdash.json) ──────────────────

export const KIRO_HOOKS_PATH = '.kiro/agents/emdash.json';

const KIRO_HOOK_SPECS = [
  { hookKey: 'agentSpawn', eventType: 'session' },
  { hookKey: 'userPromptSubmit', eventType: 'start' },
  { hookKey: 'preToolUse', eventType: 'start' },
  { hookKey: 'postToolUse', eventType: 'start' },
  { hookKey: 'stop', eventType: 'stop' },
];

export function buildKiroHookConfig(opts: HookCommandOptions = {}) {
  return {
    async readHooks(fs: CLIAgentPluginFs): Promise<HookRegistration[]> {
      const config = await readJsonConfig(fs, KIRO_HOOKS_PATH);
      const hooks = (config.hooks ?? {}) as Record<string, unknown[]>;
      const installed = KIRO_HOOK_SPECS.some(({ hookKey }) => {
        const entries = Array.isArray(hooks[hookKey]) ? hooks[hookKey] : [];
        return entries.some((e) => JSON.stringify(e).includes(EMDASH_MARKER));
      });
      return installed ? [{ event: 'emdash', command: EMDASH_MARKER }] : [];
    },
    async writeHooks(fs: CLIAgentPluginFs, _hooks: HookRegistration[]): Promise<void> {
      const config = await readJsonConfig(fs, KIRO_HOOKS_PATH);
      const hooks = (config.hooks ?? {}) as Record<string, unknown[]>;
      for (const { hookKey, eventType } of KIRO_HOOK_SPECS) {
        const existing = Array.isArray(hooks[hookKey]) ? hooks[hookKey] : [];
        hooks[hookKey] = mergeKiroEntries(existing, makeClaudeHookCommand(eventType, opts));
      }
      await writeJsonConfig(fs, KIRO_HOOKS_PATH, {
        ...config,
        name: 'emdash',
        description: 'Emdash-managed Kiro agent configuration for lifecycle hooks.',
        hooks,
      });
    },
    async deleteHooks(fs: CLIAgentPluginFs): Promise<void> {
      const config = await readJsonConfig(fs, KIRO_HOOKS_PATH);
      const hooks = (config.hooks ?? {}) as Record<string, unknown[]>;
      for (const key of Object.keys(hooks)) {
        hooks[key] = filterUserHooks(hooks[key] as Record<string, unknown>[]);
      }
      await writeJsonConfig(fs, KIRO_HOOKS_PATH, { ...config, hooks });
    },
    async getHooksInstalled(fs: CLIAgentPluginFs): Promise<boolean> {
      const config = await readJsonConfig(fs, KIRO_HOOKS_PATH);
      const hooks = (config.hooks ?? {}) as Record<string, unknown[]>;
      return KIRO_HOOK_SPECS.some(({ hookKey }) => {
        const entries = Array.isArray(hooks[hookKey]) ? hooks[hookKey] : [];
        return entries.some((e) => JSON.stringify(e).includes(EMDASH_MARKER));
      });
    },
  };
}

// ── Devin hooks (JSON, workspace .devin/hooks.v1.json) ─────────────────────

export const DEVIN_HOOKS_PATH = '.devin/hooks.v1.json';

export function buildDevinHookConfig(opts: HookCommandOptions = {}) {
  return buildClaudeStyleHookConfig(
    DEVIN_HOOKS_PATH,
    [
      { hookKey: 'Stop', eventType: 'stop' },
      { hookKey: 'SessionEnd', eventType: 'stop' },
      {
        hookKey: 'PermissionRequest',
        eventType: 'permission_prompt',
        commandFn: (_, o) => makeCodexHookCommand('permission_prompt', o),
      },
    ],
    opts
  );
}

// ── Qwen hooks (JSON, workspace .qwen/settings.json) ───────────────────────

export const QWEN_HOOKS_PATH = '.qwen/settings.json';

export function buildQwenHookConfig(opts: HookCommandOptions = {}) {
  return buildClaudeStyleHookConfig(
    QWEN_HOOKS_PATH,
    [
      { hookKey: 'PermissionRequest', eventType: 'notification' },
      { hookKey: 'Stop', eventType: 'stop' },
      { hookKey: 'SessionEnd', eventType: 'stop' },
    ],
    opts
  );
}

// ── Droid hooks (JSON, workspace .factory/settings.json) ───────────────────

export const DROID_HOOKS_PATH = '.factory/settings.json';

export function buildDroidHookConfig(opts: HookCommandOptions = {}) {
  return buildClaudeStyleHookConfig(
    DROID_HOOKS_PATH,
    [
      { hookKey: 'Notification', eventType: 'notification' },
      { hookKey: 'Stop', eventType: 'stop' },
      { hookKey: 'SessionStart', eventType: 'session' },
    ],
    opts
  );
}

// ── Claude hooks (JSON, workspace .claude/settings.local.json) ─────────────

export const CLAUDE_SETTINGS_PATH = '.claude/settings.local.json';

export function buildClaudeHookConfig(opts: HookCommandOptions = {}) {
  return buildClaudeStyleHookConfig(
    CLAUDE_SETTINGS_PATH,
    [
      { hookKey: 'Notification', eventType: 'notification' },
      { hookKey: 'Stop', eventType: 'stop' },
    ],
    opts
  );
}
