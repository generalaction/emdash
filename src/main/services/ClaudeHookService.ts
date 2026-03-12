import fs from 'fs';
import path from 'path';
import { log } from '../lib/logger';

export class ClaudeHookService {
  /**
   * Build the curl command used in Claude Code hook entries.
   *
   * The command pipes stdin directly to curl via `-d @-` to avoid any shell
   * expansion of the payload (which can contain $, backticks, etc. in
   * AI-generated text). The ptyId and event type are sent as HTTP headers
   * instead of being embedded in the JSON body.
   */
  static makeHookCommand(type: string): string {
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

  /**
   * Merge emdash hook entries into an existing settings object.
   * Strips old emdash entries (identified by the EMDASH_HOOK_PORT marker),
   * preserves user-defined hooks, and appends fresh Notification + Stop entries.
   * Returns the mutated object.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  static mergeHookEntries(existing: Record<string, any>): Record<string, any> {
    const hooks = existing.hooks || {};

    for (const eventType of ['Notification', 'Stop'] as const) {
      const prev: unknown[] = Array.isArray(hooks[eventType]) ? hooks[eventType] : [];
      const userEntries = prev.filter(
        (entry: any) => !JSON.stringify(entry).includes('EMDASH_HOOK_PORT')
      );
      userEntries.push({
        hooks: [
          { type: 'command', command: ClaudeHookService.makeHookCommand(eventType.toLowerCase()) },
        ],
      });
      hooks[eventType] = userEntries;
    }

    existing.hooks = hooks;
    return existing;
  }

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

    try {
      fs.mkdirSync(claudeDir, { recursive: true });
    } catch {
      // May already exist
    }

    ClaudeHookService.mergeHookEntries(existing);

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
