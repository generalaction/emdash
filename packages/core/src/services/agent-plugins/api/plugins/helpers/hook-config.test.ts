import { describe, expect, it, vi } from 'vitest';
import type { PluginFs } from '#primitives/plugin-fs/api';
import {
  buildFlatJsonHookConfig,
  buildFlatTomlHookConfig,
  buildNestedJsonHookConfig,
  readJsonConfig,
  readTomlConfig,
} from './hook-config';
import { EMDASH_HOOK_VERSION_MARKER, EMDASH_MARKER, makeStdinHookCommand } from './hooks';

function configFs(content: string): PluginFs {
  return {
    read: async () => content,
    write: vi.fn(async () => {}),
    delete: async () => {},
    exists: async () => true,
    list: async () => [],
  };
}

describe('hook config parsing', () => {
  it('refuses to treat invalid JSON as an empty config', async () => {
    await expect(readJsonConfig(configFs('{ invalid'), 'settings.json')).rejects.toThrow(
      'Failed to parse settings.json'
    );
  });

  it('refuses non-object JSON roots', async () => {
    await expect(readJsonConfig(configFs('[]'), 'settings.json')).rejects.toThrow(
      'expected an object at the config root'
    );
  });

  it('refuses to treat invalid TOML as an empty config', async () => {
    await expect(readTomlConfig(configFs('invalid = ['), 'config.toml')).rejects.toThrow(
      'Failed to parse config.toml'
    );
  });

  it('does not overwrite a structurally incompatible TOML hooks field', async () => {
    const fs = configFs('hooks = "custom-command"\n');
    const hooks = buildFlatTomlHookConfig('config.toml', [{ command: 'emdash' }]);

    await expect(hooks.writeHooks(fs, [])).rejects.toThrow(
      'expected "hooks" to be an array of objects'
    );
    expect(fs.write).not.toHaveBeenCalled();
  });

  it('does not overwrite a structurally incompatible JSON hooks field', async () => {
    const fs = configFs('{"hooks":[]}');
    const hooks = buildFlatJsonHookConfig('hooks.json', [{ hookKey: 'Stop', command: 'emdash' }]);

    await expect(hooks.writeHooks(fs, [])).rejects.toThrow('expected "hooks" to be an object');
    expect(fs.write).not.toHaveBeenCalled();
  });
});

describe('nested JSON hook config on Windows', () => {
  function memoryFs(content: string): PluginFs & { content: () => string } {
    let current = content;
    return {
      read: async () => current,
      write: async (_path, next) => {
        current = next;
      },
      delete: async () => {},
      exists: async () => true,
      list: async () => [],
      content: () => current,
    };
  }

  it('replaces legacy cmd.exe-wrapped entries and keeps user hooks', async () => {
    const userEntry = { hooks: [{ type: 'command', command: 'powershell.exe -File mine.ps1' }] };
    const legacyCommand =
      `cmd.exe /d /c set EMDASH_HOOK_MARKER=${EMDASH_HOOK_VERSION_MARKER} ${EMDASH_MARKER}&&` +
      'powershell.exe -NoProfile -ExecutionPolicy Bypass -EncodedCommand AAAA';
    const legacyEntry = { hooks: [{ type: 'command', command: legacyCommand }] };
    const fs = memoryFs(JSON.stringify({ hooks: { Stop: [userEntry, legacyEntry] } }));
    const command = makeStdinHookCommand('stop', { platform: 'win32' });
    const hooks = buildNestedJsonHookConfig('settings.json', [{ hookKey: 'Stop', command }]);

    expect(await hooks.getHooksInstalled(fs)).toBe(false);
    await hooks.writeHooks(fs, []);
    expect(JSON.parse(fs.content()).hooks.Stop).toEqual([
      userEntry,
      { hooks: [{ type: 'command', command }] },
    ]);
    expect(await hooks.getHooksInstalled(fs)).toBe(true);

    await hooks.deleteHooks(fs);
    expect(JSON.parse(fs.content()).hooks.Stop).toEqual([userEntry]);
  });
});
