export type LinuxPackageFormat = 'deb' | 'rpm';

/**
 * electron-builder's default `depends` lists. Setting `depends` replaces them, so they are kept
 * here: some cover libraries Electron only loads at runtime with dlopen (libnotify for
 * notifications, libsecret for safeStorage), which no ELF `NEEDED` entry reveals.
 */
const ELECTRON_BUILDER_DEPENDS: Record<LinuxPackageFormat, string[]> = {
  deb: [
    'libgtk-3-0',
    'libnotify4',
    'libnss3',
    'libxss1',
    'libxtst6',
    'xdg-utils',
    'libatspi2.0-0',
    'libuuid1',
    'libsecret-1-0',
  ],
  rpm: [
    'gtk3',
    'libnotify',
    'nss',
    'libXScrnSaver',
    '(libXtst or libXtst6)',
    'xdg-utils',
    'at-spi2-core',
    '(libuuid or libuuid1)',
  ],
};

/**
 * System libraries the packaged Electron binaries and native modules link against (their ELF
 * `NEEDED` entries), with the Debian package that provides each. Without a declared dependency
 * for each, the package installs on a minimal system but cannot start. Release verification fails
 * when a payload links a library missing here.
 *
 * Debian names are the pre-t64 ones. Since the 64-bit time_t transition (Debian 13, Ubuntu 24.04)
 * the renamed `*t64` packages provide them, so one name resolves on old and new releases. ALSA is
 * the exception: Ubuntu 24.04 also lets the OSS emulation package `liboss4-salsa-asound2` provide
 * `libasound2`, and apt picks it on minimal systems, so the real package comes first.
 */
const SYSTEM_LIBRARIES: Readonly<Record<string, string>> = {
  'libasound.so.2': 'libasound2t64 | libasound2',
  'libatk-1.0.so.0': 'libatk1.0-0',
  'libatk-bridge-2.0.so.0': 'libatk-bridge2.0-0',
  'libatspi.so.0': 'libatspi2.0-0',
  'libc.so.6': 'libc6',
  'libcairo.so.2': 'libcairo2',
  'libcups.so.2': 'libcups2',
  'libdbus-1.so.3': 'libdbus-1-3',
  'libdl.so.2': 'libc6',
  'libexpat.so.1': 'libexpat1',
  'libgbm.so.1': 'libgbm1',
  'libgcc_s.so.1': 'libgcc-s1',
  'libgio-2.0.so.0': 'libglib2.0-0',
  'libglib-2.0.so.0': 'libglib2.0-0',
  'libgobject-2.0.so.0': 'libglib2.0-0',
  'libgtk-3.so.0': 'libgtk-3-0',
  'libm.so.6': 'libc6',
  'libnspr4.so': 'libnspr4',
  'libnss3.so': 'libnss3',
  'libnssutil3.so': 'libnss3',
  'libpango-1.0.so.0': 'libpango-1.0-0',
  'libpthread.so.0': 'libc6',
  'librt.so.1': 'libc6',
  'libsmime3.so': 'libnss3',
  'libstdc++.so.6': 'libstdc++6',
  'libudev.so.1': 'libudev1',
  'libX11.so.6': 'libx11-6',
  'libxcb.so.1': 'libxcb1',
  'libXcomposite.so.1': 'libxcomposite1',
  'libXdamage.so.1': 'libxdamage1',
  'libXext.so.6': 'libxext6',
  'libXfixes.so.3': 'libxfixes3',
  'libxkbcommon.so.0': 'libxkbcommon0',
  'libXrandr.so.2': 'libxrandr2',
};

/**
 * The dynamic loader is named per architecture, while one package config serves every
 * architecture. glibc ships it alongside libc.so.6, which is declared.
 */
const DYNAMIC_LOADERS = new Set(['ld-linux-x86-64.so.2', 'ld-linux-aarch64.so.1']);

/**
 * The dependency a package must declare for a system library. RPM uses the soname capability that
 * rpmbuild generates for every shared library, so it resolves on Fedora and openSUSE alike
 * despite their different package names. All supported architectures are 64-bit.
 */
function libraryDependency(library: string, format: LinuxPackageFormat): string {
  return format === 'deb' ? SYSTEM_LIBRARIES[library] : `${library}()(64bit)`;
}

function linuxPackageDepends(format: LinuxPackageFormat): string[] {
  const libraryDependencies = Object.keys(SYSTEM_LIBRARIES).map((library) =>
    libraryDependency(library, format)
  );
  return [...new Set([...ELECTRON_BUILDER_DEPENDS[format], ...libraryDependencies])];
}

export const DEB_DEPENDS = linuxPackageDepends('deb');
export const RPM_DEPENDS = linuxPackageDepends('rpm');

export interface UndeclaredLibrary {
  library: string;
  neededBy: string[];
  /** What the package must declare, or undefined when the library is not in SYSTEM_LIBRARIES. */
  dependency?: string;
}

export function parseNeededLibraries(objdumpOutput: string): string[] {
  return Array.from(objdumpOutput.matchAll(/^\s*NEEDED\s+(\S+)\s*$/gm), (match) => match[1]);
}

/**
 * Finds libraries that a package payload links against but neither bundles nor declares as a
 * dependency.
 */
export function findUndeclaredLibraries(
  format: LinuxPackageFormat,
  neededByFile: ReadonlyMap<string, readonly string[]>,
  bundledLibraries: ReadonlySet<string>,
  declaredDependencies: ReadonlySet<string>
): UndeclaredLibrary[] {
  const undeclared = new Map<string, UndeclaredLibrary>();
  for (const [file, libraries] of neededByFile) {
    for (const library of libraries) {
      if (bundledLibraries.has(library) || DYNAMIC_LOADERS.has(library)) continue;
      const dependency = Object.hasOwn(SYSTEM_LIBRARIES, library)
        ? libraryDependency(library, format)
        : undefined;
      if (dependency !== undefined && declaredDependencies.has(dependency)) continue;
      const entry = undeclared.get(library);
      if (entry) entry.neededBy.push(file);
      else undeclared.set(library, { library, neededBy: [file], dependency });
    }
  }
  return [...undeclared.values()];
}
