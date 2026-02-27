import fs from 'fs';
import path from 'path';
import { log } from '../lib/logger';

const HOOK_COMMAND =
  "bash -c 'P=$(cat); curl -sf -X POST " +
  '-H "Content-Type: application/json" ' +
  '-H "X-Emdash-Token: $EMDASH_HOOK_TOKEN" ' +
  '-d "{\\"ptyId\\":\\"$EMDASH_PTY_ID\\",\\"type\\":\\"__TYPE__\\",\\"payload\\":$P}" ' +
  "http://127.0.0.1:$EMDASH_HOOK_PORT/hook || true'";

function makeCommand(type: string): string {
  return HOOK_COMMAND.replace('__TYPE__', type);
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

    // Merge only the hooks we own, preserve everything else.
    // Claude Code hook format: [{ hooks: [{ type, command }] }]
    // Omitting `matcher` matches all occurrences of the event.
    const hooks = existing.hooks || {};
    hooks.Notification = [
      {
        hooks: [{ type: 'command', command: makeCommand('notification') }],
      },
    ];
    hooks.Stop = [
      {
        hooks: [{ type: 'command', command: makeCommand('stop') }],
      },
    ];

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
