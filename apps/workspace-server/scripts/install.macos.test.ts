import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const installScript = resolve(dirname(fileURLToPath(import.meta.url)), '../install.sh');

describe.skipIf(process.platform !== 'darwin' || process.arch !== 'arm64')(
  'workspace-server installer with native macOS tools',
  () => {
    it('installs, upgrades, repeats, and reselects an installed version', async () => {
      const fixture = await createNativeFixture();
      try {
        const first = fixture.install('1.0.0');
        expect(first.status, first.stderr).toBe(0);
        expect(await readlink(fixture.current)).toBe('versions/1.0.0');
        const previousFiles = await readdir(resolve(fixture.root, 'versions/1.0.0'));

        const upgrade = fixture.install('1.1.0');
        expect(upgrade.status, upgrade.stderr).toBe(0);
        expect(await readlink(fixture.current)).toBe('versions/1.1.0');
        expect(await readdir(resolve(fixture.root, 'versions/1.0.0'))).toEqual(previousFiles);

        // Keep the sidecars, but make any unnecessary archive download fail.
        await rm(fixture.archive('1.0.0'));
        await rm(fixture.archive('1.1.0'));
        const repeat = fixture.install('1.1.0');
        expect(repeat.status, repeat.stderr).toBe(0);
        expect(await readlink(fixture.current)).toBe('versions/1.1.0');
        const rollback = fixture.install('1.0.0');
        expect(rollback.status, rollback.stderr).toBe(0);
        expect(await readlink(fixture.current)).toBe('versions/1.0.0');
        expect(await readdir(resolve(fixture.root, 'staging'))).toEqual([]);
      } finally {
        await fixture.cleanup();
      }
    }, 30_000);

    it('rejects a corrupted archive without replacing current and permits a retry', async () => {
      const fixture = await createNativeFixture();
      try {
        const first = fixture.install('1.0.0');
        expect(first.status, first.stderr).toBe(0);
        const archive = fixture.archive('1.1.0');
        const original = await readFile(archive);
        await writeFile(archive, 'corrupted archive');

        const failed = fixture.install('1.1.0');
        expect(failed.status, failed.stderr).toBe(41);
        expect(failed.stderr).toContain('checksum verification failed');
        expect(await readlink(fixture.current)).toBe('versions/1.0.0');
        expect(await readdir(resolve(fixture.root, 'versions'))).toEqual(['1.0.0']);
        expect(await readdir(resolve(fixture.root, 'staging'))).toEqual([]);
        expect(await readdir(fixture.root)).not.toContain('install.lock');

        await writeFile(archive, original);
        const retry = fixture.install('1.1.0');
        expect(retry.status, retry.stderr).toBe(0);
        expect(await readlink(fixture.current)).toBe('versions/1.1.0');
      } finally {
        await fixture.cleanup();
      }
    }, 30_000);
  }
);

async function createNativeFixture() {
  const directory = await mkdtemp(resolve(tmpdir(), 'emdash-install-macos-'));
  try {
    const home = resolve(directory, 'home with spaces');
    const mirror = resolve(directory, 'mirror');
    const source = resolve(directory, 'emdash-workspace-server');
    const root = resolve(home, '.emdash/workspace-server');
    const env = {
      HOME: home,
      // Exclude Homebrew and host Node: installation must use stock macOS tools
      // and the runtime inside the verified archive.
      PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
      TMPDIR: directory,
      LC_ALL: 'C',
    };
    await mkdir(home);
    await mkdir(resolve(source, 'bin'), { recursive: true });
    const launcher = resolve(source, 'bin/emdash-workspace-server');
    await writeFile(launcher, '#!/bin/sh\nexit 0\n');
    await chmod(launcher, 0o755);
    await copyFile(process.execPath, resolve(source, 'node'));
    const packed = resolve(directory, 'fixture.tar.gz');
    const tar = spawnSync(
      '/usr/bin/tar',
      ['-czf', packed, '-C', directory, 'emdash-workspace-server'],
      {
        env,
        encoding: 'utf8',
        timeout: 15_000,
      }
    );
    expect(tar.status, tar.stderr).toBe(0);
    const sha256 = createHash('sha256')
      .update(await readFile(packed))
      .digest('hex');
    const artifactName = (version: string) =>
      `emdash-workspace-server-${version}-darwin-arm64.tar.gz`;
    const archive = (version: string) => resolve(mirror, version, artifactName(version));
    for (const version of ['1.0.0', '1.1.0']) {
      await mkdir(resolve(mirror, version), { recursive: true });
      await copyFile(packed, archive(version));
      await writeFile(`${archive(version)}.sha256`, `${sha256}  ${artifactName(version)}\n`);
    }
    return {
      root,
      current: resolve(root, 'current'),
      archive,
      install: (version: string) =>
        spawnSync(
          '/bin/sh',
          [installScript, '--base-url', pathToFileURL(mirror).href, '--version', version],
          {
            env,
            encoding: 'utf8',
            timeout: 10_000,
          }
        ),
      cleanup: () => rm(directory, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
