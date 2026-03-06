import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { log } from '../lib/logger';

export const OPEN_CODE_PLUGIN_FILE = 'emdash-notify.js';
const OPEN_CODE_IDLE_MESSAGE = 'OpenCode is ready for your input';
const OPEN_CODE_PERMISSION_MESSAGE = 'OpenCode is waiting for permission';

function sanitizePtySegment(ptyId: string): string {
  return ptyId.replace(/[^A-Za-z0-9._-]/g, '-');
}

export class OpenCodeHookService {
  static getRemoteConfigDirRelative(ptyId: string): string {
    return `.config/emdash/agent-hooks/opencode/${sanitizePtySegment(ptyId)}`;
  }

  static getLocalConfigDir(ptyId: string): string {
    return path.join(app.getPath('userData'), 'agent-hooks', 'opencode', sanitizePtySegment(ptyId));
  }

  static getRemoteConfigDir(ptyId: string): string {
    return `$HOME/${OpenCodeHookService.getRemoteConfigDirRelative(ptyId)}`;
  }

  static getPluginSource(): string {
    return [
      'const HOOK_PATH = "/hook";',
      `const IDLE_MESSAGE = ${JSON.stringify(OPEN_CODE_IDLE_MESSAGE)};`,
      `const PERMISSION_MESSAGE = ${JSON.stringify(OPEN_CODE_PERMISSION_MESSAGE)};`,
      '',
      'function getHookUrl() {',
      '  const port = process.env.EMDASH_HOOK_PORT;',
      '  return port ? `http://127.0.0.1:${port}${HOOK_PATH}` : null;',
      '}',
      '',
      'async function postToEmdash(eventType, payload) {',
      '  const url = getHookUrl();',
      '  const token = process.env.EMDASH_HOOK_TOKEN;',
      '  const ptyId = process.env.EMDASH_PTY_ID;',
      '  if (!url || !token || !ptyId) return;',
      '  try {',
      '    await fetch(url, {',
      '      method: "POST",',
      '      headers: {',
      '        "Content-Type": "application/json",',
      '        "X-Emdash-Token": token,',
      '        "X-Emdash-Pty-Id": ptyId,',
      '        "X-Emdash-Event-Type": eventType,',
      '      },',
      '      body: JSON.stringify(payload),',
      '    });',
      '  } catch {}',
      '}',
      '',
      'function pickErrorMessage(event) {',
      '  const candidates = [',
      '    event?.message,',
      '    event?.properties?.message,',
      '    event?.properties?.error?.message,',
      '    event?.error?.message,',
      '    event?.properties?.detail,',
      '  ];',
      '  for (const value of candidates) {',
      '    if (typeof value === "string" && value.trim()) return value;',
      '  }',
      '  return "OpenCode session error";',
      '}',
      '',
      'export const EmdashNotifyPlugin = async () => ({',
      '  event: async ({ event }) => {',
      '    if (!event?.type) return;',
      '',
      '    if (event.type === "permission.asked") {',
      '      await postToEmdash("notification", {',
      '        notificationType: "permission_prompt",',
      '        message: PERMISSION_MESSAGE,',
      '      });',
      '      return;',
      '    }',
      '',
      '    if (event.type === "session.idle") {',
      '      await postToEmdash("notification", {',
      '        notificationType: "idle_prompt",',
      '        message: IDLE_MESSAGE,',
      '      });',
      '      return;',
      '    }',
      '',
      '    if (event.type === "session.error") {',
      '      await postToEmdash("error", {',
      '        message: pickErrorMessage(event),',
      '      });',
      '    }',
      '  },',
      '});',
      '',
    ].join('\n');
  }

  static writeLocalPlugin(ptyId: string): string {
    const configDir = OpenCodeHookService.getLocalConfigDir(ptyId);
    const pluginsDir = path.join(configDir, 'plugins');
    const pluginPath = path.join(pluginsDir, OPEN_CODE_PLUGIN_FILE);

    try {
      fs.mkdirSync(pluginsDir, { recursive: true });
      fs.writeFileSync(pluginPath, OpenCodeHookService.getPluginSource());
    } catch (err) {
      log.warn('OpenCodeHookService: failed to write local plugin', {
        path: pluginPath,
        error: String(err),
      });
    }

    return configDir;
  }
}
