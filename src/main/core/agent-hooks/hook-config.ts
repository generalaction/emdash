import type { AgentProviderId } from '@shared/agent-provider-registry';
import { resolveCommandPath } from '@main/core/dependencies/probe';
import type { IExecutionContext } from '@main/core/execution-context/types';
import type { FileSystemProvider } from '@main/core/fs/types';
import { log } from '@main/lib/logger';
import { makeClaudeHookCommand, makeOpenCodePluginContent } from './agent-notify-command';
import piEmdashExtension from './pi-emdash-extension.ts?raw';

const EMDASH_MARKER = 'EMDASH_HOOK_PORT';

const CLAUDE_SETTINGS_PATH = '.claude/settings.local.json';
const CODEX_CONFIG_PATH = '.codex/config.toml';
const CODEX_HOOKS_PATH = '.codex/hooks.json';
const PI_EMDASH_EXTENSION_PATH = '.pi/extensions/emdash-hook.ts';
const OPENCODE_PLUGIN_PATH = '.opencode/plugins/emdash-notifications.js';
const GITIGNORE_PATH = '.gitignore';
type HookConfigWriteOptions = { writeGitIgnoreEntries?: boolean };

const HOOK_EVENT_MAP = [
  { eventType: 'notification', hookKey: 'Notification' },
  { eventType: 'stop', hookKey: 'Stop' },
] satisfies { eventType: string; hookKey: string }[];

export class HookConfigWriter {
  constructor(
    private readonly fs: FileSystemProvider,
    private readonly exec: IExecutionContext
  ) {}

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
      hooks[hookKey] = this.buildHookEntries(existing, makeClaudeHookCommand(eventType));
    }

    await this.fs.write(CLAUDE_SETTINGS_PATH, JSON.stringify({ ...config, hooks }, null, 2) + '\n');
    return true;
  }

  async writeCodexHooks(): Promise<boolean> {
    if (!(await resolveCommandPath('codex', this.exec))) return false;

    const config: Record<string, unknown> = (await this.fs.exists(CODEX_HOOKS_PATH))
      ? await this.fs
          .read(CODEX_HOOKS_PATH)
          .then((r) => JSON.parse(r.content) ?? {})
          .catch(() => ({}))
      : {};

    const hooks = (config.hooks ?? {}) as Record<string, unknown[]>;
    for (const hookKey of ['Stop', 'PermissionRequest']) {
      const existing = Array.isArray(hooks[hookKey]) ? hooks[hookKey] : [];
      hooks[hookKey] = this.buildHookEntries(existing, makeClaudeHookCommand('notification'));
    }

    await this.fs.write(CODEX_HOOKS_PATH, JSON.stringify({ ...config, hooks }, null, 2) + '\n');
    await this.removeLegacyCodexNotify();
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
  ): Promise<void> {
    const writeGitIgnoreEntries = options.writeGitIgnoreEntries ?? true;

    if (providerId === 'claude') {
      const wroteConfig = await this.writeClaudeHooks();
      if (wroteConfig && writeGitIgnoreEntries) {
        await this.ensureGitIgnoreEntries([CLAUDE_SETTINGS_PATH]);
      }
      return;
    }

    if (providerId === 'codex') {
      const wroteConfig = await this.writeCodexHooks();
      if (wroteConfig && writeGitIgnoreEntries) {
        await this.ensureGitIgnoreEntries([CODEX_HOOKS_PATH]);
      }
      return;
    }

    if (providerId === 'pi') {
      const wroteConfig = await this.writePiExtension();
      if (wroteConfig && writeGitIgnoreEntries) {
        await this.ensureGitIgnoreEntries([PI_EMDASH_EXTENSION_PATH]);
      }
      return;
    }

    if (providerId === 'opencode') {
      const wroteConfig = await this.writeOpenCodePlugin();
      if (wroteConfig && writeGitIgnoreEntries) {
        await this.ensureGitIgnoreEntries([OPENCODE_PLUGIN_PATH]);
      }
      return;
    }
  }

  async writeAll(options: HookConfigWriteOptions = {}): Promise<void> {
    await Promise.all(
      (['claude', 'codex', 'pi', 'opencode'] as const).map((providerId) =>
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

  private async removeLegacyCodexNotify(): Promise<void> {
    const existing = await this.fs
      .read(CODEX_CONFIG_PATH)
      .then((result) => result.content)
      .catch(() => undefined);
    if (existing === undefined) return;

    const next = this.removeManagedTomlKey(existing, 'notify');
    if (next === existing) return;

    await this.fs.write(CODEX_CONFIG_PATH, next);
  }

  private removeManagedTomlKey(content: string, key: string): string {
    const lines = content.split(/(?<=\n)/);
    const next: string[] = [];
    let inTable = false;

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const trimmed = line.trimStart();
      if (trimmed.startsWith('[')) {
        inTable = true;
      }

      if (inTable || !new RegExp(`^${key}\\s*=`).test(trimmed)) {
        next.push(line);
        continue;
      }

      const block = [line];
      while (!this.isCompleteTomlValue(block.join('')) && index + 1 < lines.length) {
        index += 1;
        block.push(lines[index]);
      }

      if (!block.join('').includes(EMDASH_MARKER)) {
        next.push(...block);
      }
    }

    return next.join('');
  }

  private isCompleteTomlValue(value: string): boolean {
    let squareDepth = 0;
    let braceDepth = 0;
    let quote: 'single' | 'double' | undefined;
    let escaped = false;

    for (const char of value) {
      if (quote === 'double') {
        if (escaped) {
          escaped = false;
        } else if (char === '\\') {
          escaped = true;
        } else if (char === '"') {
          quote = undefined;
        }
        continue;
      }

      if (quote === 'single') {
        if (char === "'") quote = undefined;
        continue;
      }

      if (char === '"') {
        quote = 'double';
      } else if (char === "'") {
        quote = 'single';
      } else if (char === '[') {
        squareDepth += 1;
      } else if (char === ']') {
        squareDepth = Math.max(0, squareDepth - 1);
      } else if (char === '{') {
        braceDepth += 1;
      } else if (char === '}') {
        braceDepth = Math.max(0, braceDepth - 1);
      }
    }

    return quote === undefined && squareDepth === 0 && braceDepth === 0;
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
