import { describe, expect, it } from 'vitest';
import { DEB_DEPENDS, RPM_DEPENDS } from './linux-dependencies.ts';

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
