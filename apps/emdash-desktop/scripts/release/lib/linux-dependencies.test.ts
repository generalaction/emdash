import { describe, expect, it } from 'vitest';
import {
  DEB_DEPENDS,
  findUndeclaredLibraries,
  parseNeededLibraries,
  RPM_DEPENDS,
} from './linux-dependencies.ts';

describe('package depends', () => {
  it("keeps electron-builder's defaults and adds the linked libraries they miss", () => {
    expect(DEB_DEPENDS).toEqual(
      expect.arrayContaining([
        'libgtk-3-0',
        'libsecret-1-0',
        'xdg-utils',
        'libasound2t64 | libasound2',
        'libgbm1',
      ])
    );
    expect(RPM_DEPENDS).toEqual(
      expect.arrayContaining([
        'gtk3',
        '(libXtst or libXtst6)',
        'libasound.so.2()(64bit)',
        'libgbm.so.1()(64bit)',
      ])
    );
  });

  it('lists each dependency once', () => {
    expect(new Set(DEB_DEPENDS).size).toBe(DEB_DEPENDS.length);
    expect(new Set(RPM_DEPENDS).size).toBe(RPM_DEPENDS.length);
  });
});

describe('parseNeededLibraries', () => {
  it('reads NEEDED entries from objdump -p output', () => {
    const output = [
      'Dynamic Section:',
      '  NEEDED               libffmpeg.so',
      '  NEEDED               libasound.so.2',
      '  RUNPATH              $ORIGIN',
      '  SONAME               libEGL.so',
    ].join('\n');

    expect(parseNeededLibraries(output)).toEqual(['libffmpeg.so', 'libasound.so.2']);
  });
});

describe('findUndeclaredLibraries', () => {
  const executable = '/opt/Emdash/Emdash';
  const neededByFile = new Map([
    [
      executable,
      ['libffmpeg.so', 'libasound.so.2', 'libgbm.so.1', 'libc.so.6', 'ld-linux-x86-64.so.2'],
    ],
  ]);
  const bundled = new Set(['libffmpeg.so']);

  it('accepts libraries that are bundled or provided by a declared dependency', () => {
    expect(
      findUndeclaredLibraries(
        'deb',
        neededByFile,
        bundled,
        new Set(['libc6', 'libasound2t64 | libasound2', 'libgbm1'])
      )
    ).toEqual([]);
    expect(
      findUndeclaredLibraries(
        'rpm',
        neededByFile,
        bundled,
        new Set(['libc.so.6()(64bit)', 'libasound.so.2()(64bit)', 'libgbm.so.1()(64bit)'])
      )
    ).toEqual([]);
  });

  it('reports libraries whose dependency the package does not declare', () => {
    expect(
      findUndeclaredLibraries('deb', neededByFile, bundled, new Set(['libc6', 'libgtk-3-0']))
    ).toEqual([
      {
        library: 'libasound.so.2',
        neededBy: [executable],
        dependency: 'libasound2t64 | libasound2',
      },
      { library: 'libgbm.so.1', neededBy: [executable], dependency: 'libgbm1' },
    ]);
    expect(
      findUndeclaredLibraries('rpm', neededByFile, bundled, new Set(['libc.so.6()(64bit)', 'gtk3']))
    ).toEqual([
      { library: 'libasound.so.2', neededBy: [executable], dependency: 'libasound.so.2()(64bit)' },
      { library: 'libgbm.so.1', neededBy: [executable], dependency: 'libgbm.so.1()(64bit)' },
    ]);
  });

  it('reports each undeclared library once with every file that needs it', () => {
    const needed = new Map([
      [executable, ['libgbm.so.1']],
      ['/opt/Emdash/libGLESv2.so', ['libgbm.so.1']],
    ]);

    expect(findUndeclaredLibraries('deb', needed, bundled, new Set())).toEqual([
      {
        library: 'libgbm.so.1',
        neededBy: [executable, '/opt/Emdash/libGLESv2.so'],
        dependency: 'libgbm1',
      },
    ]);
  });

  it('reports libraries with no known dependency', () => {
    const needed = new Map([[executable, ['libunknown.so.1']]]);

    expect(findUndeclaredLibraries('deb', needed, bundled, new Set(DEB_DEPENDS))).toEqual([
      { library: 'libunknown.so.1', neededBy: [executable], dependency: undefined },
    ]);
  });

  it('declares every library the released x64 and arm64 payloads link against', () => {
    // NEEDED entries of the Electron 40 binaries and native modules in the v1.2.9 .deb payloads.
    const released = [
      'ld-linux-aarch64.so.1',
      'ld-linux-x86-64.so.2',
      'libX11.so.6',
      'libXcomposite.so.1',
      'libXdamage.so.1',
      'libXext.so.6',
      'libXfixes.so.3',
      'libXrandr.so.2',
      'libasound.so.2',
      'libatk-1.0.so.0',
      'libatk-bridge-2.0.so.0',
      'libatspi.so.0',
      'libc.so.6',
      'libcairo.so.2',
      'libcups.so.2',
      'libdbus-1.so.3',
      'libdl.so.2',
      'libexpat.so.1',
      'libgbm.so.1',
      'libgcc_s.so.1',
      'libgio-2.0.so.0',
      'libglib-2.0.so.0',
      'libgobject-2.0.so.0',
      'libgtk-3.so.0',
      'libm.so.6',
      'libnspr4.so',
      'libnss3.so',
      'libnssutil3.so',
      'libpango-1.0.so.0',
      'libpthread.so.0',
      'librt.so.1',
      'libsmime3.so',
      'libstdc++.so.6',
      'libudev.so.1',
      'libxcb.so.1',
      'libxkbcommon.so.0',
    ];
    const needed = new Map([[executable, released]]);

    expect(findUndeclaredLibraries('deb', needed, bundled, new Set(DEB_DEPENDS))).toEqual([]);
    expect(findUndeclaredLibraries('rpm', needed, bundled, new Set(RPM_DEPENDS))).toEqual([]);
  });
});
