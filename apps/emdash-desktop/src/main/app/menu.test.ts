import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  buildFromTemplate: vi.fn((template: Electron.MenuItemConstructorOptions[]) => ({ template })),
  reloadActiveBrowser: vi.fn(),
  reloadMainWindow: vi.fn(),
  setApplicationMenu: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    name: 'Emdash',
    getVersion: vi.fn(() => '1.1.40'),
    quit: vi.fn(),
    showAboutPanel: vi.fn(),
  },
  clipboard: { writeText: vi.fn() },
  Menu: {
    buildFromTemplate: mocks.buildFromTemplate,
    setApplicationMenu: mocks.setApplicationMenu,
  },
  shell: { openExternal: vi.fn() },
}));

vi.mock('@main/core/browser/browser-webcontents-registry', () => ({
  browserWebContentsRegistry: { reloadActiveBrowser: mocks.reloadActiveBrowser },
}));

vi.mock('@main/lib/events', () => ({
  events: { emit: vi.fn() },
}));

vi.mock('@main/lib/telemetry', () => ({
  telemetryService: { getInstanceId: vi.fn(() => null) },
}));

vi.mock('./window', () => ({
  getMainWindow: () => ({ webContents: { reload: mocks.reloadMainWindow } }),
}));

const { setupApplicationMenu } = await import('./menu');

function clickReloadMenuItem(): void {
  setupApplicationMenu();
  const template = mocks.buildFromTemplate.mock.calls.at(-1)?.[0] ?? [];
  const viewMenu = template.find((item) => item.label === 'View');
  const reloadItem = Array.isArray(viewMenu?.submenu) ? viewMenu.submenu[0] : undefined;

  expect(reloadItem).toMatchObject({ label: 'Reload', accelerator: 'CmdOrCtrl+R' });
  if (typeof reloadItem === 'object' && reloadItem && 'click' in reloadItem) {
    reloadItem.click?.({} as Electron.MenuItem, {} as Electron.BrowserWindow, {});
  }
}

describe('application menu reload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reloads the active embedded browser without reloading Emdash', () => {
    mocks.reloadActiveBrowser.mockReturnValue(true);

    clickReloadMenuItem();

    expect(mocks.reloadActiveBrowser).toHaveBeenCalledOnce();
    expect(mocks.reloadMainWindow).not.toHaveBeenCalled();
  });

  it('keeps app reload as the fallback when no browser tab is active', () => {
    mocks.reloadActiveBrowser.mockReturnValue(false);

    clickReloadMenuItem();

    expect(mocks.reloadMainWindow).toHaveBeenCalledOnce();
  });
});
