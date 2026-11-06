import { cp, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createPackage, extractAll, extractFile, statFile } from '@electron/asar';
import { Arch, Platform, build as packageApp, type Configuration } from 'electron-builder';
import { build } from 'electron-vite';
import { expect, it } from 'vitest';
import canaryConfig from '../../../electron-builder.canary.config.ts';
import stableConfig from '../../../electron-builder.config.ts';
import packageJson from '../../../package.json';
import { createReleaseBuildConfig } from './build-config.ts';
import {
  packagedLanguageServerApp,
  type PackagedLanguageServerApp,
} from './packaged-language-servers.ts';
import { verifyPackagedSsh } from './packaged-ssh.ts';

async function buildSshProbe(root: string): Promise<void> {
  const entry = join(root, 'probe.ts');
  await writeFile(
    entry,
    `import ssh2, { BaseAgent } from 'ssh2';
     console.log(typeof ssh2.Client, typeof BaseAgent);`
  );
  const configFile = join(root, 'electron.vite.config.mjs');
  // Keep production transforms/externalization; omit the adapter-copy plugin's checkout writes.
  await writeFile(
    configFile,
    `import config from ${JSON.stringify(resolve('electron.vite.config.ts'))};
     export default { main: {
       ...config.main,
       plugins: [],
       build: {
         ...config.main.build,
         outDir: ${JSON.stringify(join(root, 'out/main'))},
         rollupOptions: {
           ...config.main.build.rollupOptions,
           input: { index: ${JSON.stringify(entry)} }
         }
       }
     } };`
  );
  await build({ configFile });
}

it('emits the real ssh2 entry without bundling its directory-relative runtime', async () => {
  const root = await mkdtemp(join(tmpdir(), 'emdash-build-ssh-'));
  try {
    await buildSshProbe(root);
    const output = await readFile(join(root, 'out/main/index.js'), 'utf8');
    expect(output).toMatch(/from ["']ssh2\/lib\/index\.js["']/);
    expect(output).not.toMatch(/from ["']ssh2["']/);
    expect(output).not.toContain('pagent.exe');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// Uses the real dependency collector, pruning, ASAR writer, and Electron runtime.
// Opt in locally; the release build runs the verifier on the complete finished app.
const packagingCases = [
  ['stable', stableConfig, Platform.current()],
  ['canary', canaryConfig, Platform.current()],
  ...(process.platform === 'win32'
    ? []
    : [
        ['stable Windows', stableConfig, Platform.WINDOWS] as const,
        ['canary Windows', canaryConfig, Platform.WINDOWS] as const,
      ]),
] as const;

it.runIf(process.env.EMDASH_TEST_PACKAGED_SSH === '1').each(packagingCases)(
  '%s packaged ssh2 preserves the emitted ESM import and runtime resources',
  async (_channel, baseConfig, platform) => {
    const root = await mkdtemp(join(tmpdir(), 'emdash-package-ssh-'));
    const requirePackage = createRequire(import.meta.url);
    try {
      await buildSshProbe(root);
      await writeFile(
        join(root, 'package.json'),
        JSON.stringify({
          name: 'emdash-packaged-ssh',
          version: '1.0.0',
          type: 'module',
          main: 'out/main/index.js',
          dependencies: { ssh2: packageJson.dependencies.ssh2 },
        })
      );
      // Leave optional native addons absent to exercise ssh2's JavaScript fallbacks.
      for (const name of ['ssh2', 'asn1', 'bcrypt-pbkdf', 'safer-buffer', 'tweetnacl']) {
        await cp(
          dirname(requirePackage.resolve(`${name}/package.json`)),
          join(root, 'node_modules', name),
          { recursive: true }
        );
      }
      const apps: PackagedLanguageServerApp[] = [];
      const config: Configuration = {
        ...createReleaseBuildConfig(baseConfig, packageJson.devDependencies.electron),
        directories: { output: join(root, 'packaged') },
        extraResources: [],
        // Cookie encryption is unrelated to this probe; avoid modifying the cached binary's
        // signature so the unsigned fixture can run on macOS without a signing identity.
        electronFuses: undefined,
        mac: { identity: null, hardenedRuntime: false, notarize: false },
        linux: { ...baseConfig.linux, icon: undefined },
        win: { signAndEditExecutable: false },
        afterPack: async (context) => {
          apps.push(packagedLanguageServerApp(context));
        },
      };
      await packageApp({
        projectDir: root,
        config,
        targets: platform.createTarget(
          'dir',
          platform === Platform.WINDOWS
            ? Arch.x64
            : process.arch === 'arm64'
              ? Arch.arm64
              : Arch.x64
        ),
        publish: 'never',
      });
      expect(apps).toHaveLength(1);
      const app = apps[0];
      const archive = join(app.resourcesDirectory, 'app.asar');
      expect(extractFile(archive, 'out/main/index.js').toString()).toMatch(
        /from ["']ssh2\/lib\/index\.js["']/
      );
      expect(extractFile(archive, 'node_modules/ssh2/lib/index.js').length).toBeGreaterThan(0);
      if (platform === Platform.WINDOWS) {
        const helper = 'node_modules/ssh2/util/pagent.exe';
        expect(statFile(archive, helper).unpacked).toBe(true);
        expect(extractFile(archive, helper).length).toBeGreaterThan(0);
      }
      // Cross-built Windows fixtures validate the archive but cannot execute on this host.
      if (platform !== Platform.current()) return;
      await verifyPackagedSsh(app);

      // Prove the guard observes package contents, rather than the development install.
      const moduleRoot = join(app.resourcesDirectory, 'app.asar.unpacked/node_modules/ssh2');
      if (process.platform === 'win32') {
        for (const missing of ['lib/index.js', 'util/pagent.exe']) {
          const asset = join(moduleRoot, missing);
          await rename(asset, `${asset}.missing`);
          try {
            await expect(verifyPackagedSsh(app)).rejects.toThrow();
          } finally {
            await rename(`${asset}.missing`, asset);
          }
        }
      } else {
        // On other platforms the dependency is inside app.asar (pagent.exe is pruned).
        const broken = join(root, 'broken');
        extractAll(archive, broken);
        await rm(join(broken, 'node_modules/ssh2/lib/index.js'));
        await createPackage(broken, archive);
        await expect(verifyPackagedSsh(app)).rejects.toThrow();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
  180_000
);
