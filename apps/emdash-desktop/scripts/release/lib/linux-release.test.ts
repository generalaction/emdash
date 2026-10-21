import { describe, expect, it } from 'vitest';
import {
  linuxArtifactName,
  linuxPackageArch,
  objdumpMatchesArch,
  parseLinuxTargets,
  selectLinuxNativeModules,
} from './linux-release.ts';

describe('linuxArtifactName', () => {
  it('uses each package format architecture convention', () => {
    expect(linuxArtifactName('emdash', 'x64', 'AppImage')).toBe('emdash-x86_64.AppImage');
    expect(linuxArtifactName('emdash', 'x64', 'deb')).toBe('emdash-amd64.deb');
    expect(linuxArtifactName('emdash', 'x64', 'rpm')).toBe('emdash-x86_64.rpm');
    expect(linuxArtifactName('emdash', 'arm64', 'AppImage')).toBe('emdash-arm64.AppImage');
    expect(linuxArtifactName('emdash', 'arm64', 'deb')).toBe('emdash-arm64.deb');
    expect(linuxArtifactName('emdash', 'arm64', 'rpm')).toBe('emdash-aarch64.rpm');
  });
});

describe('linuxPackageArch', () => {
  it('maps runtime architectures to package metadata architectures', () => {
    expect(linuxPackageArch('x64', 'deb')).toBe('amd64');
    expect(linuxPackageArch('arm64', 'deb')).toBe('arm64');
    expect(linuxPackageArch('x64', 'rpm')).toBe('x86_64');
    expect(linuxPackageArch('arm64', 'rpm')).toBe('aarch64');
  });
});

describe('parseLinuxTargets', () => {
  it('accepts and deduplicates supported targets', () => {
    expect(parseLinuxTargets('AppImage,deb,rpm,deb')).toEqual(['AppImage', 'deb', 'rpm']);
  });

  it('rejects unknown targets', () => {
    expect(parseLinuxTargets('AppImage,snap')).toBeNull();
  });
});

describe('objdumpMatchesArch', () => {
  it('recognizes x64 and arm64 object headers', () => {
    expect(objdumpMatchesArch('architecture: i386:x86-64, flags 0x00000150:', 'x64')).toBe(true);
    expect(objdumpMatchesArch('architecture: aarch64, flags 0x00000150:', 'arm64')).toBe(true);
  });

  it('rejects the wrong architecture', () => {
    expect(objdumpMatchesArch('architecture: i386:x86-64, flags 0x00000150:', 'arm64')).toBe(false);
  });
});

describe('selectLinuxNativeModules', () => {
  const common = [
    '/payload/resources/app.asar.unpacked/node_modules/better-sqlite3/build/Release/better_sqlite3.node',
    '/payload/resources/app.asar.unpacked/node_modules/node-pty/build/Release/pty.node',
  ];

  it('selects runtime-active x64 modules and ignores dormant foreign prebuilds', () => {
    const activeWatcher =
      '/payload/resources/app.asar.unpacked/node_modules/@parcel/watcher-linux-x64-glibc/watcher.node';
    const selection = selectLinuxNativeModules(
      [
        ...common,
        activeWatcher,
        '/payload/resources/app.asar.unpacked/node_modules/node-pty/prebuilds/darwin-arm64/pty.node',
        '/payload/resources/app.asar.unpacked/node_modules/node-pty/prebuilds/win32-x64/pty.node',
        '/payload/resources/app.asar.unpacked/node_modules/@parcel/watcher-linux-arm64-glibc/watcher.node',
      ],
      'x64'
    );

    expect(selection.selected).toEqual([...common, activeWatcher]);
    expect(selection.missing).toEqual([]);
    expect(selection.duplicates).toEqual([]);
  });

  it('reports missing and duplicate active modules', () => {
    const duplicate = common[0].replace('/payload/', '/other-payload/');
    const selection = selectLinuxNativeModules([...common, duplicate], 'arm64');

    expect(selection.missing.map(({ moduleName }) => moduleName)).toEqual(['@parcel/watcher']);
    expect(selection.duplicates).toHaveLength(1);
    expect(selection.duplicates[0].moduleName).toBe('better-sqlite3');
  });
});
