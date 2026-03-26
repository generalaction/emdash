import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/emdash-test',
  },
}));

import { mergeApps } from '../openInRegistry';
import type { CustomOpenInApp } from '@shared/openInApps';

describe('mergeApps', () => {
  it('returns built-in apps when no customs provided', () => {
    const result = mergeApps([], 'linux');
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((app) => !app.isCustom)).toBe(true);
  });

  it('appends custom tools after built-ins', () => {
    const customs: CustomOpenInApp[] = [
      { id: 'my-tool', label: 'My Tool', openCommand: 'my-tool {{path}}' },
    ];
    const result = mergeApps(customs, 'linux');
    const last = result[result.length - 1];
    expect(last.id).toBe('my-tool');
    expect(last.isCustom).toBe(true);
    expect(last.label).toBe('My Tool');
    expect(last.openCommands).toEqual(['my-tool {{path}}']);
  });

  it('overrides a built-in when custom has the same id', () => {
    const customs: CustomOpenInApp[] = [
      { id: 'terminal', label: 'My Terminal', openCommand: 'my-term {{path}}' },
    ];
    const result = mergeApps(customs, 'linux');
    const terminal = result.find((a) => a.id === 'terminal');
    expect(terminal).toBeDefined();
    expect(terminal!.isCustom).toBe(true);
    expect(terminal!.label).toBe('My Terminal');
    expect(terminal!.openCommands).toEqual(['my-term {{path}}']);
    // Should be at the same position as the original, not appended
    expect(result.filter((a) => a.id === 'terminal')).toHaveLength(1);
  });

  it('preserves built-in metadata when overriding', () => {
    const customs: CustomOpenInApp[] = [
      { id: 'vscode', label: 'My VS Code', openCommand: 'my-code {{path}}' },
    ];
    const result = mergeApps(customs, 'darwin');
    const vscode = result.find((a) => a.id === 'vscode');
    expect(vscode!.isCustom).toBe(true);
    expect(vscode!.label).toBe('My VS Code');
    expect(vscode!.openCommands).toEqual(['my-code {{path}}']);
    // Built-in metadata should be preserved
    expect(vscode!.supportsRemote).toBe(true);
    expect(vscode!.autoInstall).toBe(true);
    // Built-in icon should be preserved when no custom iconPath
    expect(vscode!.iconPath).toBe('vscode.png');
    expect(vscode!.iconIsCustomPath).toBe(false);
  });

  it('marks custom tools without checkCommand as alwaysAvailable', () => {
    const customs: CustomOpenInApp[] = [
      { id: 'no-check', label: 'No Check', openCommand: 'cmd {{path}}' },
    ];
    const result = mergeApps(customs, 'linux');
    const app = result.find((a) => a.id === 'no-check');
    expect(app!.alwaysAvailable).toBe(true);
  });

  it('does not mark custom tools with checkCommand as alwaysAvailable', () => {
    const customs: CustomOpenInApp[] = [
      { id: 'has-check', label: 'Has Check', openCommand: 'cmd {{path}}', checkCommand: 'cmd' },
    ];
    const result = mergeApps(customs, 'linux');
    const app = result.find((a) => a.id === 'has-check');
    expect(app!.alwaysAvailable).toBe(false);
    expect(app!.checkCommands).toEqual(['cmd']);
  });

  it('sets iconIsCustomPath for custom tools', () => {
    const customs: CustomOpenInApp[] = [
      {
        id: 'with-icon',
        label: 'With Icon',
        openCommand: 'cmd {{path}}',
        iconPath: '/usr/share/icons/tool.png',
      },
    ];
    const result = mergeApps(customs, 'linux');
    const app = result.find((a) => a.id === 'with-icon');
    expect(app!.iconIsCustomPath).toBe(true);
    expect(app!.iconPath).toBe('/usr/share/icons/tool.png');
  });

  it('resolves built-in apps for the given platform', () => {
    const result = mergeApps([], 'darwin');
    const finder = result.find((a) => a.id === 'finder');
    expect(finder).toBeDefined();
    expect(finder!.label).toBe('Finder');
    expect(finder!.openCommands).toContain('open {{path}}');

    const linuxResult = mergeApps([], 'linux');
    const files = linuxResult.find((a) => a.id === 'finder');
    expect(files!.label).toBe('Files');
  });
});
