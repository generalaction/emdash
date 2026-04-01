import * as toml from 'smol-toml';
import { resolveCommandPath } from '@main/core/dependencies/probe';
import type { FileSystemProvider } from '@main/core/fs/types';
import type { ExecFn } from '@main/core/utils/exec';
import { log } from '@main/lib/logger';

const EMDASH_MARKER = 'EMDASH_HOOK_PORT';

const CLAUDE_SETTINGS_PATH = '.claude/settings.local.json';
const CODEX_CONFIG_PATH = '.codex/config.toml';

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

  async writeClaudeHooks(): Promise<void> {
    if (!(await resolveCommandPath('claude', this.exec))) return;

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
  }

  async writeCodexNotify(): Promise<void> {
    if (!(await resolveCommandPath('codex', this.exec))) return;

    const config: Record<string, unknown> = await this.fs
      .read(CODEX_CONFIG_PATH)
      .then((result) => toml.parse(result.content) ?? {})
      .catch(() => ({}));

    config.notify = makeCodexNotifyCommand();
    await this.fs.write(CODEX_CONFIG_PATH, toml.stringify(config));
  }

  async writeAll(): Promise<void> {
    await Promise.all([
      this.writeClaudeHooks().catch((err: Error) => {
        log.warn('Failed to write Claude hook config', { error: String(err) });
      }),
      this.writeCodexNotify().catch((err: Error) => {
        log.warn('Failed to write Codex notify config', { error: String(err) });
      }),
    ]);
  }

  private buildHookEntries(existing: unknown[], command: string): unknown[] {
    const userEntries = existing.filter((entry) => !JSON.stringify(entry).includes(EMDASH_MARKER));
    return [...userEntries, { hooks: [{ type: 'command', command }] }];
  }
}
