import { z } from 'zod';

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

type OpenInAppConfigShape = {
  id: string;
  label: string;
  iconPath: (typeof ICON_PATHS)[keyof typeof ICON_PATHS];
  invertInDark?: boolean;
  alwaysAvailable?: boolean;
  hideIfUnavailable?: boolean;
  autoInstall?: boolean;
  supportsRemote?: boolean;
  variantOf?: string;
  platforms: Partial<Record<PlatformKey, PlatformConfig>>;
};

const ICON_PATHS = {
  finder: 'finder.png',
  explorer: 'explorer.svg',
  files: 'files.svg',
  cursor: 'cursor.svg',
  vscode: 'vscode.png',
  windsurf: 'windsurf.png',
  xcode: 'xcode.png',
  terminal: 'terminal.png',
  warp: 'warp.png',
  iterm2: 'iterm2.png',
  ghostty: 'ghostty.png',
  zed: 'zed.png',
  'zed-nightly': 'zed-nightly.png',
  'intellij-idea': 'intellij-idea.svg',
  webstorm: 'webstorm.svg',
  pycharm: 'pycharm.svg',
  rustrover: 'rustrover.svg',
  kiro: 'kiro.png',
  antigravity: 'antigravity.png',
} as const;

const _OPEN_IN_APPS = {
  finder: {
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
  cursor: {
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
  vscode: {
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
  windsurf: {
    id: 'windsurf',
    label: 'Windsurf',
    iconPath: ICON_PATHS.windsurf,
    autoInstall: true,
    platforms: {
      darwin: {
        openCommands: [
          'command -v windsurf >/dev/null 2>&1 && windsurf {{path}}',
          'open -n -b com.exafunction.windsurf --args {{path}}',
          'open -n -a "Windsurf" {{path}}',
        ],
        checkCommands: ['windsurf'],
        bundleIds: ['com.exafunction.windsurf'],
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
  xcode: {
    id: 'xcode',
    label: 'Xcode',
    iconPath: ICON_PATHS.xcode,
    platforms: {
      darwin: {
        openCommands: [
          'command -v xed >/dev/null 2>&1 && xed {{path}}',
          'open -n -b com.apple.dt.Xcode --args {{path}}',
          'open -n -a "Xcode" {{path}}',
        ],
        checkCommands: ['xed'],
        bundleIds: ['com.apple.dt.Xcode'],
        appNames: ['Xcode'],
      },
    },
  },
  terminal: {
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
  warp: {
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
  iterm2: {
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
  ghostty: {
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
  zed: {
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
  'zed-nightly': {
    id: 'zed-nightly',
    label: 'Zed Nightly',
    iconPath: ICON_PATHS['zed-nightly'],
    hideIfUnavailable: true,
    variantOf: 'zed',
    platforms: {
      darwin: {
        openCommands: [
          'command -v zed-nightly >/dev/null 2>&1 && zed-nightly {{path}}',
          'open -n -b dev.zed.Zed-Nightly --args {{path}}',
          'open -a "Zed Nightly" {{path}}',
        ],
        checkCommands: ['zed-nightly'],
        bundleIds: ['dev.zed.Zed-Nightly'],
        appNames: ['Zed Nightly'],
      },
      linux: {
        openCommands: ['zed-nightly {{path}}'],
        checkCommands: ['zed-nightly'],
      },
    },
  },
  kiro: {
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
  antigravity: {
    id: 'antigravity',
    label: 'Antigravity',
    iconPath: ICON_PATHS.antigravity,
    autoInstall: true,
    platforms: {
      darwin: {
        openCommands: [
          'command -v antigravity >/dev/null 2>&1 && antigravity {{path}}',
          'open -a "Antigravity" {{path}}',
        ],
        checkCommands: ['antigravity'],
        appNames: ['Antigravity'],
      },
      win32: {
        openCommands: ['start "" antigravity {{path}}'],
        checkCommands: ['antigravity'],
      },
      linux: {
        openCommands: ['antigravity {{path}}'],
        checkCommands: ['antigravity'],
      },
    },
  },
  'intellij-idea': {
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
  webstorm: {
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
  pycharm: {
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
  rustrover: {
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
} satisfies Record<string, OpenInAppConfigShape>;

export type OpenInAppId = keyof typeof _OPEN_IN_APPS;

export type OpenInAppConfig = OpenInAppConfigShape & { id: OpenInAppId };

// Re-export as a properly typed Record so Object.values() yields OpenInAppConfig[]
// and app.id is narrowed to OpenInAppId throughout the codebase.
export const OPEN_IN_APPS: Record<OpenInAppId, OpenInAppConfig> = _OPEN_IN_APPS as Record<
  OpenInAppId,
  OpenInAppConfig
>;

export const OPEN_IN_APP_IDS = Object.keys(OPEN_IN_APPS) as [OpenInAppId, ...OpenInAppId[]];

export const openInAppIdSchema = z.enum(OPEN_IN_APP_IDS);

export function getAppById(id: string): OpenInAppConfig | undefined {
  return isValidOpenInAppId(id) ? OPEN_IN_APPS[id] : undefined;
}

export function isValidOpenInAppId(value: unknown): value is OpenInAppId {
  return typeof value === 'string' && value in OPEN_IN_APPS;
}

export function getResolvedLabel(app: OpenInAppConfigShape, platform: PlatformKey): string {
  return app.platforms[platform]?.label || app.label;
}

export function getResolvedIconPath(app: OpenInAppConfigShape, platform: PlatformKey): string {
  return app.platforms[platform]?.iconPath || app.iconPath;
}
