export type OpenInIconKey =
  | 'finder'
  | 'cursor'
  | 'vscode'
  | 'terminal'
  | 'ghostty'
  | 'zed'
  | 'iterm2'
  | 'warp';

export type PlatformKey = 'darwin' | 'win32' | 'linux';

export type PlatformConfig = {
  openCommands?: string[];
  openUrls?: string[];
  checkCommands?: string[];
  bundleIds?: string[];
  appNames?: string[];
};

type OpenInAppConfigShape = {
  id: string;
  label: string;
  iconKey: OpenInIconKey;
  iconPath: string;
  alwaysAvailable?: boolean;
  autoInstall?: boolean;
  platforms: Partial<Record<PlatformKey, PlatformConfig>>;
};

export const OPEN_IN_APPS = [
  {
    id: 'finder',
    label: 'Finder',
    iconKey: 'finder',
    iconPath: '../../assets/images/finder.png',
    alwaysAvailable: true,
    platforms: {
      darwin: { openCommands: ['open {{path}}'] },
      win32: { openCommands: ['explorer {{path}}'] },
      linux: { openCommands: ['xdg-open {{path}}'] },
    },
  },
  {
    id: 'cursor',
    label: 'Cursor',
    iconKey: 'cursor',
    iconPath: '../../assets/images/cursorlogo.png',
    autoInstall: true,
    platforms: {
      darwin: {
        openCommands: [
          'command -v cursor >/dev/null 2>&1 && cursor {{path}}',
          'open -a "Cursor" {{path}}',
        ],
        checkCommands: ['cursor'],
        appNames: ['Cursor'],
      },
      win32: {
        openCommands: ['start "" cursor {{path}}'],
        checkCommands: ['cursor'],
      },
      linux: {
        openCommands: ['cursor {{path}}'],
        checkCommands: ['cursor'],
      },
    },
  },
  {
    id: 'vscode',
    label: 'VS Code',
    iconKey: 'vscode',
    iconPath: '../../assets/images/vscode.png',
    autoInstall: true,
    platforms: {
      darwin: {
        openCommands: [
          'command -v code >/dev/null 2>&1 && code {{path}}',
          'open -n -b com.microsoft.VSCode --args {{path}}',
          'open -n -a "Visual Studio Code" {{path}}',
        ],
        checkCommands: ['code'],
        bundleIds: ['com.microsoft.VSCode', 'com.microsoft.VSCodeInsiders'],
        appNames: ['Visual Studio Code'],
      },
      win32: {
        openCommands: ['start "" code {{path}}', 'start "" code-insiders {{path}}'],
        checkCommands: ['code', 'code-insiders'],
      },
      linux: {
        openCommands: ['code {{path}}', 'code-insiders {{path}}'],
        checkCommands: ['code', 'code-insiders'],
      },
    },
  },
  {
    id: 'terminal',
    label: 'Terminal',
    iconKey: 'terminal',
    iconPath: '../../assets/images/terminal.png',
    alwaysAvailable: true,
    platforms: {
      darwin: { openCommands: ['open -a Terminal {{path}}'] },
      win32: {
        openCommands: ['wt -d {{path}}', 'start cmd /K "cd /d {{path_raw}}"'],
      },
      linux: {
        openCommands: [
          'x-terminal-emulator --working-directory={{path}}',
          'gnome-terminal --working-directory={{path}}',
          'konsole --workdir {{path}}',
        ],
      },
    },
  },
  {
    id: 'warp',
    label: 'Warp',
    iconKey: 'warp',
    iconPath: '../../assets/images/warp.svg',
    platforms: {
      darwin: {
        openUrls: [
          'warp://action/new_window?path={{path_url}}',
          'warppreview://action/new_window?path={{path_url}}',
        ],
        bundleIds: ['dev.warp.Warp-Stable'],
      },
    },
  },
  {
    id: 'iterm2',
    label: 'iTerm2',
    iconKey: 'iterm2',
    iconPath: '../../assets/images/iterm2.png',
    platforms: {
      darwin: {
        openCommands: [
          'open -b com.googlecode.iterm2 {{path}}',
          'open -a "iTerm" {{path}}',
          'open -a "iTerm2" {{path}}',
        ],
        bundleIds: ['com.googlecode.iterm2'],
        appNames: ['iTerm', 'iTerm2'],
      },
    },
  },
  {
    id: 'ghostty',
    label: 'Ghostty',
    iconKey: 'ghostty',
    iconPath: '../../assets/images/ghostty.png',
    platforms: {
      darwin: {
        openCommands: ['open -b com.mitchellh.ghostty {{path}}', 'open -a "Ghostty" {{path}}'],
        bundleIds: ['com.mitchellh.ghostty'],
        appNames: ['Ghostty'],
      },
      linux: {
        openCommands: ['ghostty --working-directory={{path}}'],
        checkCommands: ['ghostty'],
      },
    },
  },
  {
    id: 'zed',
    label: 'Zed',
    iconKey: 'zed',
    iconPath: '../../assets/images/zed.png',
    autoInstall: true,
    platforms: {
      darwin: {
        openCommands: ['command -v zed >/dev/null 2>&1 && zed {{path}}', 'open -a "Zed" {{path}}'],
        checkCommands: ['zed'],
        appNames: ['Zed'],
      },
      linux: {
        openCommands: ['zed {{path}}', 'xdg-open {{path}}'],
        checkCommands: ['zed'],
      },
    },
  },
] as const satisfies readonly OpenInAppConfigShape[];

export type OpenInAppId = (typeof OPEN_IN_APPS)[number]['id'];

export type OpenInAppConfig = Omit<OpenInAppConfigShape, 'id'> & { id: OpenInAppId };

export function getAppById(id: string): OpenInAppConfig | undefined {
  return OPEN_IN_APPS.find((app) => app.id === id);
}

export function getAppConfigForPlatform(
  appId: string,
  platform: PlatformKey
): PlatformConfig | undefined {
  const app = getAppById(appId);
  return app?.platforms[platform];
}

export function getAvailableAppsForPlatform(platform: PlatformKey): OpenInAppConfig[] {
  return OPEN_IN_APPS.filter((app) => {
    const platformConfig = (app as any).platforms[platform];
    return platformConfig !== undefined || (app as any).alwaysAvailable;
  });
}
