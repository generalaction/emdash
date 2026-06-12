import type {
  HostDependencyDescriptor,
  InstallOption,
  Platform,
} from '../../../host-dependencies/capability';

/** Build a single homebrew InstallOption fragment — composable via npmDependency extraOptions. */
export function homebrewOption(opts: {
  formula: string;
  cask?: boolean;
  recommended?: boolean;
}): InstallOption {
  const flag = opts.cask ? '--cask ' : '';
  return {
    method: 'homebrew',
    command: `brew install ${flag}${opts.formula}`,
    updateCommand: `brew upgrade ${flag}${opts.formula}`,
    uninstallCommand: `brew uninstall ${flag}${opts.formula}`,
    ...(opts.recommended ? { recommended: true } : {}),
  };
}

/** Build a full HostDependencyDescriptor for a globally-installed npm package. */
export function npmDependency(opts: {
  id: string;
  /** Bare package name used for npm install, update, uninstall, and releaseSource. */
  package: string;
  /** Binary names to probe; defaults to [opts.id]. */
  binaryNames?: string[];
  /** Extra flags inserted between `npm install -g` and the package (e.g. '--ignore-scripts'). */
  installFlags?: string;
  /**
   * Version qualifier appended to the install command only (e.g. '@latest').
   * Not appended to update/uninstall commands or releaseSource.
   */
  versionSuffix?: string;
  /** Mark the npm option as the recommended install choice (default true). */
  recommended?: boolean;
  /** Optional link to documentation shown in the UI. */
  installDocs?: string;
  /** Skip executing the CLI after resolving its path (for CLIs with side-effectful --version). */
  skipVersionProbe?: boolean;
  /** Args passed when probing for a version string; defaults to ['--version']. */
  versionArgs?: string[];
  /** Extra InstallOption entries appended per platform after the npm option. */
  extraOptions?: Partial<Record<Platform, InstallOption[]>>;
}): HostDependencyDescriptor {
  const recommended = opts.recommended !== false;
  const flags = opts.installFlags ? `${opts.installFlags} ` : '';
  const installCmd = `npm install -g ${flags}${opts.package}${opts.versionSuffix ?? ''}`;
  const uninstallCmd = `npm uninstall -g ${opts.package}`;

  const npmOption: InstallOption = {
    method: 'npm',
    command: installCmd,
    uninstallCommand: uninstallCmd,
    ...(recommended ? { recommended: true } : {}),
  };

  const perPlatform = (platform: Platform): InstallOption[] => [
    npmOption,
    ...(opts.extraOptions?.[platform] ?? []),
  ];

  return {
    id: opts.id,
    binaryNames: opts.binaryNames ?? [opts.id],
    ...(opts.installDocs ? { installDocs: opts.installDocs } : {}),
    ...(opts.skipVersionProbe ? { skipVersionProbe: true } : {}),
    ...(opts.versionArgs ? { versionArgs: opts.versionArgs } : {}),
    installCommands: {
      macos: perPlatform('macos'),
      linux: perPlatform('linux'),
      windows: perPlatform('windows'),
    },
    updates: {
      kind: 'supported',
      releaseSource: { kind: 'npm', package: opts.package },
      update: { kind: 'package-manager' },
    },
    uninstall: { kind: 'package-manager' },
  };
}
