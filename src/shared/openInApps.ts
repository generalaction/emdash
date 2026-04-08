export type PlatformKey = 'darwin' | 'win32' | 'linux';

export type PlatformConfig = {
  openCommands?: string[];
  openUrls?: string[];
  checkCommands?: string[];
  bundleIds?: string[];
  appNames?: string[];
  label?: string;
  iconPath?: string;
};

export type OpenInAppConfigShape = {
  id: string;
  label: string;
  iconPath: (typeof ICON_PATHS)[keyof typeof ICON_PATHS];
  invertInDark?: boolean;
  alwaysAvailable?: boolean;
  hideIfUnavailable?: boolean;
  autoInstall?: boolean;
  supportsRemote?: boolean;
  platforms: Partial<Record<PlatformKey, PlatformConfig>>;
};

const ICON_PATHS = {
  finder: 'finder.png',
  explorer: 'explorer.svg',
  files: 'files.svg',
  cursor: 'cursor.svg',
  vscode: 'vscode.png',
  vscodium: 'vscodium.png',
  terminal: 'terminal.png',
  xcode: 'xcode.png',
  warp: 'warp.svg',
  iterm2: 'iterm2.png',
  ghostty: 'ghostty.png',
  zed: 'zed.png',
  'intellij-idea': 'intellij-idea.svg',
  webstorm: 'webstorm.svg',
  pycharm: 'pycharm.svg',
  rustrover: 'rustrover.svg',
  phpstorm: 'phpstorm.svg',
  'android-studio': 'android-studio.svg',
  kiro: 'kiro.png',
  windsurf: 'windsurf.svg',
} as const;

export const OPEN_IN_APPS: OpenInAppConfigShape[] = [
  {
    id: 'finder',
    label: 'Finder',
    iconPath: ICON_PATHS.finder,
    alwaysAvailable: true,
    platforms: {
      darwin: { openCommands: ['open {{path}}'] },
      win32: {
        openCommands: ['explorer "{{path_raw}}"'],
        label: 'Explorer',
        iconPath: ICON_PATHS.explorer,
      },
      linux: {
        openCommands: ['xdg-open {{path}}'],
        label: 'Files',
        iconPath: ICON_PATHS.files,
      },
    },
  },
  {
    id: 'cursor',
    label: 'Cursor',
    iconPath: ICON_PATHS.cursor,
    invertInDark: true,
    autoInstall: true,
    supportsRemote: true,
    platforms: {
      darwin: {
        openCommands: ['command -v cursor >/dev/null 2>&1 && cursor .', 'open -a "Cursor" .'],
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
    iconPath: ICON_PATHS.vscode,
    autoInstall: true,
    supportsRemote: true,
    platforms: {
      darwin: {
        openCommands: [
          'command -v code >/dev/null 2>&1 && code {{path}}',
          'open -n -b com.microsoft.VSCode --args {{path}}',
          'open -n -a "Visual Studio Code" {{path}}',
        ],
        checkCommands: ['code'],
        bundleIds: ['com.microsoft.VSCode'],
        appNames: ['Visual Studio Code'],
      },
      win32: {
        openCommands: ['start "" code {{path}}'],
        checkCommands: ['code'],
      },
      linux: {
        openCommands: ['code {{path}}'],
        checkCommands: ['code'],
      },
    },
  },
  {
    id: 'vscode-insiders',
    label: 'VS Code Insiders',
    iconPath: ICON_PATHS.vscode,
    autoInstall: true,
    hideIfUnavailable: true,
    platforms: {
      darwin: {
        openCommands: [
          'command -v code-insiders >/dev/null 2>&1 && code-insiders {{path}}',
          'open -n -b com.microsoft.VSCodeInsiders --args {{path}}',
          'open -n -a "Visual Studio Code - Insiders" {{path}}',
        ],
        checkCommands: ['code-insiders'],
        bundleIds: ['com.microsoft.VSCodeInsiders'],
        appNames: ['Visual Studio Code - Insiders'],
      },
      win32: {
        openCommands: ['start "" code-insiders {{path}}'],
        checkCommands: ['code-insiders'],
      },
      linux: {
        openCommands: ['code-insiders {{path}}'],
        checkCommands: ['code-insiders'],
      },
    },
  },
  {
    id: 'vscodium',
    label: 'VSCodium',
    iconPath: ICON_PATHS.vscodium,
    platforms: {
      darwin: {
        openCommands: [
          'command -v codium >/dev/null 2>&1 && codium {{path}}',
          'open -n -b com.vscodium --args {{path}}',
          'open -n -a "VSCodium" {{path}}',
        ],
        checkCommands: ['codium'],
        bundleIds: ['com.vscodium'],
        appNames: ['VSCodium'],
      },
      win32: {
        openCommands: ['start "" codium {{path}}'],
        checkCommands: ['codium'],
      },
      linux: {
        openCommands: ['codium {{path}}'],
        checkCommands: ['codium'],
      },
    },
  },
  {
    id: 'terminal',
    label: 'Terminal',
    iconPath: ICON_PATHS.terminal,
    alwaysAvailable: true,
    supportsRemote: true,
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
    id: 'xcode',
    label: 'Xcode',
    iconPath: ICON_PATHS.xcode,
    hideIfUnavailable: true,
    platforms: {
      darwin: {
        openCommands: ['open -b com.apple.dt.Xcode {{path}}', 'open -a "Xcode" {{path}}'],
        bundleIds: ['com.apple.dt.Xcode'],
        appNames: ['Xcode'],
      },
    },
  },
  {
    id: 'warp',
    label: 'Warp',
    iconPath: ICON_PATHS.warp,
    supportsRemote: true,
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
    iconPath: ICON_PATHS.iterm2,
    supportsRemote: true,
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
    iconPath: ICON_PATHS.ghostty,
    supportsRemote: true,
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
    id: 'foot',
    label: 'Foot',
    iconPath: ICON_PATHS.terminal,
    supportsRemote: true,
    platforms: {
      linux: {
        openCommands: [
          'footclient --working-directory={{path}}',
          'foot --working-directory={{path}}',
        ],
        checkCommands: ['footclient', 'foot'],
      },
    },
  },
  {
    id: 'zed',
    label: 'Zed',
    iconPath: ICON_PATHS.zed,
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
  {
    id: 'kiro',
    label: 'Kiro',
    iconPath: ICON_PATHS.kiro,
    autoInstall: true,
    platforms: {
      darwin: {
        openCommands: [
          'command -v kiro >/dev/null 2>&1 && kiro {{path}}',
          'open -a "Kiro" {{path}}',
        ],
        checkCommands: ['kiro'],
        bundleIds: ['dev.kiro.desktop'],
        appNames: ['Kiro'],
      },
      win32: {
        openCommands: ['start "" kiro {{path}}'],
        checkCommands: ['kiro'],
      },
      linux: {
        openCommands: ['kiro {{path}}'],
        checkCommands: ['kiro'],
      },
    },
  },
  {
    id: 'windsurf',
    label: 'Windsurf',
    iconPath: ICON_PATHS.windsurf,
    invertInDark: true,
    autoInstall: true,
    supportsRemote: true,
    platforms: {
      darwin: {
        openCommands: [
          'command -v windsurf >/dev/null 2>&1 && windsurf {{path}}',
          'open -n -b com.codeium.windsurf --args {{path}}',
          'open -n -a "Windsurf" {{path}}',
        ],
        checkCommands: ['windsurf'],
        bundleIds: ['com.codeium.windsurf'],
        appNames: ['Windsurf'],
      },
      win32: {
        openCommands: ['start "" windsurf {{path}}'],
        checkCommands: ['windsurf'],
      },
      linux: {
        openCommands: ['windsurf {{path}}'],
        checkCommands: ['windsurf'],
      },
    },
  },
  {
    id: 'intellij-idea',
    label: 'IntelliJ IDEA',
    iconPath: ICON_PATHS['intellij-idea'],
    hideIfUnavailable: true,
    platforms: {
      darwin: {
        openCommands: ['open -a "IntelliJ IDEA" {{path}}'],
        bundleIds: ['com.jetbrains.intellij'],
        appNames: ['IntelliJ IDEA'],
      },
      win32: {
        openCommands: ['idea64 {{path}}', 'idea {{path}}'],
        checkCommands: ['idea64', 'idea'],
      },
      linux: {
        openCommands: ['idea {{path}}'],
        checkCommands: ['idea'],
      },
    },
  },
  {
    id: 'webstorm',
    label: 'WebStorm',
    iconPath: ICON_PATHS.webstorm,
    hideIfUnavailable: true,
    platforms: {
      darwin: {
        openCommands: ['open -a "WebStorm" {{path}}'],
        bundleIds: ['com.jetbrains.WebStorm'],
        appNames: ['WebStorm'],
      },
      win32: {
        openCommands: ['webstorm64 {{path}}', 'webstorm {{path}}'],
        checkCommands: ['webstorm64', 'webstorm'],
      },
      linux: {
        openCommands: ['webstorm {{path}}'],
        checkCommands: ['webstorm'],
      },
    },
  },
  {
    id: 'pycharm',
    label: 'PyCharm',
    iconPath: ICON_PATHS.pycharm,
    hideIfUnavailable: true,
    platforms: {
      darwin: {
        openCommands: ['open -a "PyCharm" {{path}}'],
        bundleIds: ['com.jetbrains.pycharm'],
        appNames: ['PyCharm'],
      },
      win32: {
        openCommands: ['pycharm64 {{path}}', 'pycharm {{path}}'],
        checkCommands: ['pycharm64', 'pycharm'],
      },
      linux: {
        openCommands: ['pycharm {{path}}'],
        checkCommands: ['pycharm'],
      },
    },
  },
  {
    id: 'rustrover',
    label: 'RustRover',
    iconPath: ICON_PATHS.rustrover,
    hideIfUnavailable: true,
    platforms: {
      darwin: {
        openCommands: ['open -a "RustRover" {{path}}'],
        bundleIds: ['com.jetbrains.rustrover'],
        appNames: ['RustRover'],
      },
      win32: {
        openCommands: ['rustrover64 {{path}}', 'rustrover {{path}}'],
        checkCommands: ['rustrover64', 'rustrover'],
      },
      linux: {
        openCommands: ['rustrover {{path}}'],
        checkCommands: ['rustrover'],
      },
    },
  },
  {
    id: 'phpstorm',
    label: 'PhpStorm',
    iconPath: ICON_PATHS.phpstorm,
    hideIfUnavailable: true,
    platforms: {
      darwin: {
        openCommands: ['open -a "PhpStorm" {{path}}'],
        bundleIds: ['com.jetbrains.PhpStorm'],
        appNames: ['PhpStorm'],
      },
      win32: {
        openCommands: ['phpstorm64 {{path}}', 'phpstorm {{path}}'],
        checkCommands: ['phpstorm64', 'phpstorm'],
      },
      linux: {
        openCommands: ['phpstorm {{path}}'],
        checkCommands: ['phpstorm'],
      },
    },
  },
  {
    id: 'android-studio',
    label: 'Android Studio',
    iconPath: ICON_PATHS['android-studio'],
    hideIfUnavailable: true,
    platforms: {
      darwin: {
        openCommands: ['studio {{path}}', 'open -a "Android Studio" {{path}}'],
        bundleIds: ['com.google.android.studio'],
        appNames: ['Android Studio'],
        checkCommands: ['studio'],
      },
      win32: {
        openCommands: ['studio64 {{path}}', 'studio {{path}}'],
        checkCommands: ['studio64', 'studio'],
      },
      linux: {
        openCommands: ['studio {{path}}'],
        checkCommands: ['studio'],
      },
    },
  },
] as const;

export type OpenInAppId = (typeof OPEN_IN_APPS)[number]['id'];

export type OpenInAppConfig = OpenInAppConfigShape & { id: OpenInAppId };

export function getAppById(id: string): OpenInAppConfig | undefined {
  return OPEN_IN_APPS.find((app) => app.id === id);
}

export function isValidOpenInAppId(value: unknown): value is OpenInAppId {
  return typeof value === 'string' && OPEN_IN_APPS.some((app) => app.id === value);
}

export function isOpenInAppSupportedForWorkspace(
  app: Pick<OpenInAppConfigShape, 'supportsRemote'>,
  isRemote: boolean
): boolean {
  return !isRemote || app.supportsRemote === true;
}

export function getResolvedLabel(app: OpenInAppConfigShape, platform: PlatformKey): string {
  return app.platforms[platform]?.label || app.label;
}

export function getResolvedIconPath(app: OpenInAppConfigShape, platform: PlatformKey): string {
  return app.platforms[platform]?.iconPath || app.iconPath;
}

/** Shape of a user-defined tool entry in settings.json. */
export interface CustomOpenInApp {
  id: string;
  label: string;
  openCommand: string;
  checkCommand?: string;
  iconPath?: string;
}

/** Flattened, single-platform representation used as wire format between main and renderer. */
export type ResolvedOpenInApp = {
  id: string;
  label: string;
  iconPath: string;
  iconIsCustomPath: boolean;
  openCommands: string[];
  openUrls: string[];
  checkCommands: string[];
  bundleIds: string[];
  appNames: string[];
  alwaysAvailable: boolean;
  hideIfUnavailable: boolean;
  autoInstall: boolean;
  supportsRemote: boolean;
  invertInDark: boolean;
  isCustom: boolean;
};

/** Resolve a built-in app config to the flattened single-platform shape. */
export function resolveAppForPlatform(
  app: OpenInAppConfigShape,
  platform: PlatformKey
): ResolvedOpenInApp {
  const pc = app.platforms[platform];
  return {
    id: app.id,
    label: pc?.label || app.label,
    iconPath: pc?.iconPath || app.iconPath,
    iconIsCustomPath: false,
    openCommands: pc?.openCommands ?? [],
    openUrls: pc?.openUrls ?? [],
    checkCommands: pc?.checkCommands ?? [],
    bundleIds: pc?.bundleIds ?? [],
    appNames: pc?.appNames ?? [],
    alwaysAvailable: app.alwaysAvailable ?? false,
    hideIfUnavailable: app.hideIfUnavailable ?? false,
    autoInstall: app.autoInstall ?? false,
    supportsRemote: app.supportsRemote ?? false,
    invertInDark: app.invertInDark ?? false,
    isCustom: false,
  };
}
