import fs from 'fs';
import path from 'path';
import { log } from '../lib/logger';

// Hook command pipes stdin directly to curl via -d @- to avoid any shell
// expansion of the payload (which can contain $, backticks, etc. in
// AI-generated text). The ptyId and event type are sent as HTTP headers
// instead of being embedded in the JSON body.
function makeCommand(type: string): string {
  return (
    'curl -sf -X POST ' +
    '-H "Content-Type: application/json" ' +
    '-H "X-Emdash-Token: $EMDASH_HOOK_TOKEN" ' +
    `-H "X-Emdash-Pty-Id: $EMDASH_PTY_ID" ` +
    `-H "X-Emdash-Event-Type: ${type}" ` +
    '-d @- ' +
    '"http://127.0.0.1:$EMDASH_HOOK_PORT/hook" || true'
  );
}

export class ClaudeHookService {
  static writeHookConfig(worktreePath: string): void {
    const claudeDir = path.join(worktreePath, '.claude');
    const settingsPath = path.join(claudeDir, 'settings.local.json');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let existing: Record<string, any> = {};
    try {
      const content = fs.readFileSync(settingsPath, 'utf-8');
      existing = JSON.parse(content);
    } catch {
      // File doesn't exist or isn't valid JSON — start fresh
    }

    // Ensure .claude directory exists
    try {
      fs.mkdirSync(claudeDir, { recursive: true });
    } catch {
      // May already exist
    }

    // Merge our hook entries alongside any user-defined hooks.
    // Claude Code hook format: [{ matcher?, hooks: [{ type, command }] }]
    // We identify our own entries by the EMDASH_HOOK_PORT marker in the
    // command string, strip them out, then append a fresh one. This is
    // idempotent across restarts and preserves user hooks.
    const hooks = existing.hooks || {};

    for (const eventType of ['Notification', 'Stop'] as const) {
      const prev: unknown[] = Array.isArray(hooks[eventType]) ? hooks[eventType] : [];
      const userEntries = prev.filter(
        (entry: any) => !JSON.stringify(entry).includes('EMDASH_HOOK_PORT')
      );
      userEntries.push({
        hooks: [{ type: 'command', command: makeCommand(eventType.toLowerCase()) }],
      });
      hooks[eventType] = userEntries;
    }

    existing.hooks = hooks;

    try {
      fs.writeFileSync(settingsPath, JSON.stringify(existing, null, 2) + '\n');
    } catch (err) {
      log.warn('ClaudeHookService: failed to write hook config', {
        path: settingsPath,
        error: String(err),
      });
    }
  }
}
