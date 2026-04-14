import * as toml from 'smol-toml';
import type { AgentProviderId } from '@shared/agent-provider-registry';
import { resolveCommandPath } from '@main/core/dependencies/probe';
import type { FileSystemProvider } from '@main/core/fs/types';
import type { ExecFn } from '@main/core/utils/exec';
import { log } from '@main/lib/logger';

const EMDASH_MARKER = 'EMDASH_HOOK_PORT';

const CLAUDE_SETTINGS_PATH = '.claude/settings.local.json';
const CODEX_CONFIG_PATH = '.codex/config.toml';
const GITIGNORE_PATH = '.gitignore';

const HOOK_EVENT_MAP = [
  { eventType: 'notification', hookKey: 'Notification' },
  { eventType: 'stop', hookKey: 'Stop' },
] satisfies { eventType: string; hookKey: string }[];

function makeClaudeHookCommand(eventType: string): string {
  return (
    'curl -sf -X POST ' +
    '-H "Content-Type: application/json" ' +
    '-H "X-Emdash-Token: $EMDASH_HOOK_TOKEN" ' +
    '-H "X-Emdash-Pty-Id: $EMDASH_PTY_ID" ' +
    `-H "X-Emdash-Event-Type: ${eventType}" ` +
    '-d @- ' +
    '"http://127.0.0.1:$EMDASH_HOOK_PORT/hook" || true'
  );
}

function makeCodexNotifyCommand(): string[] {
  return [
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
}

export class HookConfigWriter {
  constructor(
    private readonly fs: FileSystemProvider,
    private readonly exec: ExecFn
  ) {}

  async writeClaudeHooks(): Promise<boolean> {
    if (!(await resolveCommandPath('claude', this.exec))) return false;

    const config: Record<string, unknown> = await this.fs
      .read(CLAUDE_SETTINGS_PATH)
      .then((r) => JSON.parse(r.content) ?? {})
      .catch(() => ({}));

    const hooks = (config.hooks ?? {}) as Record<string, unknown[]>;

    for (const { eventType, hookKey } of HOOK_EVENT_MAP) {
      const existing = Array.isArray(hooks[hookKey]) ? hooks[hookKey] : [];
      hooks[hookKey] = this.buildHookEntries(existing, makeClaudeHookCommand(eventType));
    }

    await this.fs.write(CLAUDE_SETTINGS_PATH, JSON.stringify({ ...config, hooks }, null, 2) + '\n');
    return true;
  }

  async writeCodexNotify(): Promise<boolean> {
    if (!(await resolveCommandPath('codex', this.exec))) return false;

    const config: Record<string, unknown> = await this.fs
      .read(CODEX_CONFIG_PATH)
      .then((result) => toml.parse(result.content) ?? {})
      .catch(() => ({}));

    config.notify = makeCodexNotifyCommand();
    await this.fs.write(CODEX_CONFIG_PATH, toml.stringify(config));
    return true;
  }

  async writeForProvider(providerId: AgentProviderId): Promise<void> {
    if (providerId === 'claude') {
      const wroteConfig = await this.writeClaudeHooks();
      if (wroteConfig) await this.ensureGitIgnoreEntries([CLAUDE_SETTINGS_PATH]);
      return;
    }

    if (providerId === 'codex') {
      const wroteConfig = await this.writeCodexNotify();
      if (wroteConfig) await this.ensureGitIgnoreEntries([CODEX_CONFIG_PATH]);
    }
  }

  async writeAll(): Promise<void> {
    await Promise.all(
      (['claude', 'codex'] as const).map((providerId) =>
        this.writeForProvider(providerId).catch((err: Error) => {
          log.warn(`Failed to write ${providerId} hook config`, { error: String(err) });
        })
      )
    );
  }

  private buildHookEntries(existing: unknown[], command: string): unknown[] {
    const userEntries = existing.filter((entry) => !JSON.stringify(entry).includes(EMDASH_MARKER));
    return [...userEntries, { hooks: [{ type: 'command', command }] }];
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
