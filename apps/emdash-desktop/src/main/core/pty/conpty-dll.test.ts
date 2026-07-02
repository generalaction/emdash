import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  conptyDllPresentUnder,
  resetConptyDllCacheForTests,
  resolveUseConptyDll,
} from './conpty-dll';

describe('conpty-dll', () => {
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!;
  let tempRoot: string;

  function setPlatform(platform: NodeJS.Platform): void {
    Object.defineProperty(process, 'platform', {
      ...originalPlatform,
      value: platform,
    });
  }

  beforeEach(() => {
    resetConptyDllCacheForTests();
    tempRoot = mkdtempSync(path.join(os.tmpdir(), 'emdash-conpty-'));
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', originalPlatform);
    vi.unstubAllEnvs();
    resetConptyDllCacheForTests();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  describe('resolveUseConptyDll', () => {
    it('is false on non-Windows platforms', () => {
      setPlatform('darwin');
      expect(resolveUseConptyDll()).toBe(false);
    });

    it('is false when disabled via EMDASH_DISABLE_CONPTY_DLL', () => {
      setPlatform('win32');
      vi.stubEnv('EMDASH_DISABLE_CONPTY_DLL', '1');
      expect(resolveUseConptyDll()).toBe(false);
    });
  });

  describe('conptyDllPresentUnder', () => {
    function makeDir(...segments: string[]): string {
      const dir = path.join(tempRoot, ...segments);
      mkdirSync(dir, { recursive: true });
      return dir;
    }

    it('is true when the dll sits next to the rebuilt conpty.node', () => {
      const release = makeDir('build', 'Release');
      writeFileSync(path.join(release, 'conpty.node'), '');
      const dllDir = makeDir('build', 'Release', 'conpty');
      writeFileSync(path.join(dllDir, 'conpty.dll'), '');
      writeFileSync(path.join(dllDir, 'OpenConsole.exe'), '');

      expect(conptyDllPresentUnder(tempRoot)).toBe(true);
    });

    it('is false when the rebuilt output lacks the dll (electron-rebuild wiped it)', () => {
      const release = makeDir('build', 'Release');
      writeFileSync(path.join(release, 'conpty.node'), '');
      // Prebuilds carry the dll, but build/Release wins node-pty's search order.
      const prebuilds = makeDir('prebuilds', `${process.platform}-${process.arch}`);
      writeFileSync(path.join(prebuilds, 'conpty.node'), '');
      const prebuiltDllDir = makeDir('prebuilds', `${process.platform}-${process.arch}`, 'conpty');
      writeFileSync(path.join(prebuiltDllDir, 'conpty.dll'), '');

      expect(conptyDllPresentUnder(tempRoot)).toBe(false);
    });

    it('falls back to prebuilds when no rebuilt output exists', () => {
      const prebuilds = makeDir('prebuilds', `${process.platform}-${process.arch}`);
      writeFileSync(path.join(prebuilds, 'conpty.node'), '');
      const dllDir = makeDir('prebuilds', `${process.platform}-${process.arch}`, 'conpty');
      writeFileSync(path.join(dllDir, 'conpty.dll'), '');
      writeFileSync(path.join(dllDir, 'OpenConsole.exe'), '');

      expect(conptyDllPresentUnder(tempRoot)).toBe(true);
    });

    it('is false when no native module exists at all', () => {
      expect(conptyDllPresentUnder(tempRoot)).toBe(false);
    });
  });
});
