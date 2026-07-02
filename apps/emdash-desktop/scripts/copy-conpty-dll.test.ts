import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { copyConptyDll } from './copy-conpty-dll.ts';

describe('copyConptyDll', () => {
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!;
  let nodePtyRoot: string;

  beforeEach(() => {
    nodePtyRoot = mkdtempSync(path.join(os.tmpdir(), 'emdash-copy-conpty-'));
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', originalPlatform);
    rmSync(nodePtyRoot, { recursive: true, force: true });
  });

  function makeDir(...segments: string[]): string {
    const dir = path.join(nodePtyRoot, ...segments);
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  function seedThirdParty(arch: string): void {
    const sourceDir = makeDir('third_party', 'conpty', '1.0.0', `win10-${arch}`);
    writeFileSync(path.join(sourceDir, 'conpty.dll'), `dll-${arch}`);
    writeFileSync(path.join(sourceDir, 'OpenConsole.exe'), `exe-${arch}`);
  }

  function seedRebuiltOutput(): void {
    const release = makeDir('build', 'Release');
    writeFileSync(path.join(release, 'conpty.node'), '');
  }

  it('is a no-op on non-Windows platforms', () => {
    Object.defineProperty(process, 'platform', { ...originalPlatform, value: 'linux' });
    seedThirdParty('x64');
    seedRebuiltOutput();

    expect(copyConptyDll({ nodePtyRoot, arch: 'x64' })).toBe(false);
    expect(existsSync(path.join(nodePtyRoot, 'build', 'Release', 'conpty'))).toBe(false);
  });

  describe('on Windows', () => {
    beforeEach(() => {
      Object.defineProperty(process, 'platform', { ...originalPlatform, value: 'win32' });
    });

    it('copies the bundled dll next to the rebuilt conpty.node', () => {
      seedThirdParty('x64');
      seedRebuiltOutput();

      expect(copyConptyDll({ nodePtyRoot, arch: 'x64' })).toBe(true);

      const destDir = path.join(nodePtyRoot, 'build', 'Release', 'conpty');
      expect(readFileSync(path.join(destDir, 'conpty.dll'), 'utf8')).toBe('dll-x64');
      expect(readFileSync(path.join(destDir, 'OpenConsole.exe'), 'utf8')).toBe('exe-x64');
    });

    it('copies the requested architecture', () => {
      seedThirdParty('x64');
      seedThirdParty('arm64');
      seedRebuiltOutput();

      expect(copyConptyDll({ nodePtyRoot, arch: 'arm64' })).toBe(true);

      const destDir = path.join(nodePtyRoot, 'build', 'Release', 'conpty');
      expect(readFileSync(path.join(destDir, 'conpty.dll'), 'utf8')).toBe('dll-arm64');
    });

    it('skips when there is no rebuilt output', () => {
      seedThirdParty('x64');

      expect(copyConptyDll({ nodePtyRoot, arch: 'x64' })).toBe(false);
      expect(existsSync(path.join(nodePtyRoot, 'build'))).toBe(false);
    });

    it('skips when node-pty ships no bundled ConPTY', () => {
      seedRebuiltOutput();

      expect(copyConptyDll({ nodePtyRoot, arch: 'x64' })).toBe(false);
    });

    it('ignores entries without the full arch payload instead of picking the first one', () => {
      makeDir('third_party', 'conpty', '0.0.0-empty');
      const incomplete = makeDir('third_party', 'conpty', '0.5.0', 'win10-x64');
      writeFileSync(path.join(incomplete, 'conpty.dll'), 'dll-incomplete');
      seedThirdParty('x64');
      seedRebuiltOutput();

      expect(copyConptyDll({ nodePtyRoot, arch: 'x64' })).toBe(true);

      const destDir = path.join(nodePtyRoot, 'build', 'Release', 'conpty');
      expect(readFileSync(path.join(destDir, 'conpty.dll'), 'utf8')).toBe('dll-x64');
      expect(readFileSync(path.join(destDir, 'OpenConsole.exe'), 'utf8')).toBe('exe-x64');
    });

    it('skips without throwing when no version folder has the requested arch', () => {
      seedThirdParty('x64');
      seedRebuiltOutput();

      expect(copyConptyDll({ nodePtyRoot, arch: 'arm64' })).toBe(false);
      expect(existsSync(path.join(nodePtyRoot, 'build', 'Release', 'conpty'))).toBe(false);
    });

    it('skips unsupported architectures', () => {
      seedThirdParty('x64');
      seedRebuiltOutput();

      expect(copyConptyDll({ nodePtyRoot, arch: 'ia32' })).toBe(false);
    });
  });
});
