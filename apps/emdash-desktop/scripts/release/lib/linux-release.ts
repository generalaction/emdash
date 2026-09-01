export const LINUX_ARCHES = ['x64', 'arm64'] as const;
export const LINUX_TARGETS = ['AppImage', 'deb', 'rpm'] as const;

export type LinuxArch = (typeof LINUX_ARCHES)[number];
export type LinuxTarget = (typeof LINUX_TARGETS)[number];

const ARTIFACT_ARCH: Record<LinuxTarget, Record<LinuxArch, string>> = {
  AppImage: { x64: 'x86_64', arm64: 'arm64' },
  deb: { x64: 'amd64', arm64: 'arm64' },
  rpm: { x64: 'x86_64', arm64: 'aarch64' },
};

const PACKAGE_ARCH: Record<'deb' | 'rpm', Record<LinuxArch, string>> = {
  deb: { x64: 'amd64', arm64: 'arm64' },
  rpm: { x64: 'x86_64', arm64: 'aarch64' },
};

const OBJDUMP_ARCH: Record<LinuxArch, string> = {
  x64: 'i386:x86-64',
  arm64: 'aarch64',
};

interface LinuxNativeModuleRequirement {
  moduleName: string;
  pathSuffix: string;
}

export interface LinuxNativeModuleSelection {
  selected: string[];
  missing: LinuxNativeModuleRequirement[];
  duplicates: Array<LinuxNativeModuleRequirement & { files: string[] }>;
}

function linuxNativeModuleRequirements(arch: LinuxArch): LinuxNativeModuleRequirement[] {
  return [
    {
      moduleName: 'better-sqlite3',
      pathSuffix: 'node_modules/better-sqlite3/build/Release/better_sqlite3.node',
    },
    {
      moduleName: 'node-pty',
      pathSuffix: 'node_modules/node-pty/build/Release/pty.node',
    },
    {
      moduleName: '@parcel/watcher',
      pathSuffix: `node_modules/@parcel/watcher-linux-${arch}-glibc/watcher.node`,
    },
  ];
}

export function isLinuxArch(value: string): value is LinuxArch {
  return LINUX_ARCHES.some((arch) => arch === value);
}

export function parseLinuxTargets(value: string): LinuxTarget[] | null {
  const targets = value.split(',');
  if (
    targets.length === 0 ||
    targets.some((target) => !LINUX_TARGETS.some((knownTarget) => knownTarget === target))
  ) {
    return null;
  }
  return [...new Set(targets)] as LinuxTarget[];
}

export function linuxArtifactName(prefix: string, arch: LinuxArch, target: LinuxTarget): string {
  return `${prefix}-${ARTIFACT_ARCH[target][arch]}.${target}`;
}

export function linuxPackageArch(arch: LinuxArch, target: 'deb' | 'rpm'): string {
  return PACKAGE_ARCH[target][arch];
}

export function objdumpArch(arch: LinuxArch): string {
  return OBJDUMP_ARCH[arch];
}

export function objdumpMatchesArch(output: string, arch: LinuxArch): boolean {
  const architecture = output.match(/architecture:\s*([^,\n]+)/)?.[1]?.trim();
  return architecture === objdumpArch(arch);
}

/**
 * Selects only native binaries that Linux can load at runtime. Some dependencies ship dormant
 * Darwin and Windows prebuilds in the package; validating those against the Linux architecture
 * would reject an otherwise correct release.
 */
export function selectLinuxNativeModules(
  files: readonly string[],
  arch: LinuxArch
): LinuxNativeModuleSelection {
  const normalized = files.map((file) => ({ file, normalized: file.replaceAll('\\', '/') }));
  const selected: string[] = [];
  const missing: LinuxNativeModuleRequirement[] = [];
  const duplicates: Array<LinuxNativeModuleRequirement & { files: string[] }> = [];

  for (const requirement of linuxNativeModuleRequirements(arch)) {
    const matches = normalized
      .filter(
        ({ normalized: file }) =>
          file === requirement.pathSuffix || file.endsWith(`/${requirement.pathSuffix}`)
      )
      .map(({ file }) => file);
    if (matches.length === 0) missing.push(requirement);
    else if (matches.length > 1) duplicates.push({ ...requirement, files: matches });
    else selected.push(matches[0]);
  }

  return { selected, missing, duplicates };
}
