import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Arch, Platform, build, type Configuration } from 'electron-builder';
import { expect, it, vi } from 'vitest';
import canaryConfig from '../../../electron-builder.canary.config.ts';
import stableConfig from '../../../electron-builder.config.ts';
import packageJson from '../../../package.json';
import { createReleaseBuildConfig } from './build-config.ts';
import {
  packagedLanguageServerApp,
  verifyPackagedLanguageServers,
  type PackagedLanguageServerApp,
} from './packaged-language-servers.ts';

// Real Electron packaging is opt-in: the ordinary unit-test job skips its binary download.
// Release builds invoke the same verifier against the full finished desktop app.
it.runIf(process.env.EMDASH_TEST_PACKAGED_LSP === '1').each([
  ['stable', stableConfig],
  ['canary', canaryConfig],
] as const)(
  '%s packaged servers use their shipped runtime and libraries without global tools',
  async (_channel, baseConfig) => {
    const root = await mkdtemp(join(tmpdir(), 'emdash-package-lsp-'));
    const packageRequire = createRequire(import.meta.url);
    vi.stubEnv('CSC_IDENTITY_AUTO_DISCOVERY', 'false');
    try {
      const names = ['typescript', 'typescript-language-server', 'pyright'] as const;
      await mkdir(join(root, 'out/main'), { recursive: true });
      await writeFile(join(root, 'out/main/index.js'), 'process.exit(0);');
      await writeFile(
        join(root, 'package.json'),
        JSON.stringify({
          name: 'emdash-packaged-language-servers',
          version: '1.0.0',
          main: 'out/main/index.js',
          dependencies: Object.fromEntries(
            names.map((name) => [name, packageJson.dependencies[name]])
          ),
        })
      );
      for (const name of names) {
        const source =
          name === 'typescript-language-server'
            ? dirname(dirname(packageRequire.resolve(`${name}/lib/cli.mjs`)))
            : dirname(packageRequire.resolve(`${name}/package.json`));
        await cp(source, join(root, 'node_modules', name), { recursive: true });
      }
      const packaged: PackagedLanguageServerApp[] = [];
      const config: Configuration = {
        ...createReleaseBuildConfig(baseConfig, packageJson.devDependencies.electron),
        directories: { output: join(root, 'packaged') },
        mac: { identity: null, hardenedRuntime: false, notarize: false },
        linux: { ...baseConfig.linux, icon: undefined },
        win: { signAndEditExecutable: false },
        afterPack: async (context) => {
          packaged.push(packagedLanguageServerApp(context));
        },
      };
      await build({
        projectDir: root,
        config,
        targets: Platform.current().createTarget(
          'dir',
          process.arch === 'arm64' ? Arch.arm64 : Arch.x64
        ),
        publish: 'never',
      });
      expect(packaged).toHaveLength(1);
      const app = packaged[0];
      if (process.platform === 'darwin') {
        // As in the boot benchmark, sign the unsigned fixture bottom-up after fuse edits.
        // This avoids signing identities and retains the entitlements needed for V8's JIT.
        const entitlements = fileURLToPath(
          new URL('../../../build/entitlements.mac.plist', import.meta.url)
        );
        const sign = (target: string, withEntitlements: boolean) =>
          execFileSync(
            'codesign',
            [
              '--force',
              '--sign',
              '-',
              ...(withEntitlements ? ['--entitlements', entitlements] : []),
              target,
            ],
            { stdio: 'pipe' }
          );
        const frameworks = join(dirname(app.resourcesDirectory), 'Frameworks');
        for (const entry of await readdir(frameworks)) {
          if (entry.endsWith('.framework')) sign(join(frameworks, entry), false);
          if (entry.endsWith('.app')) sign(join(frameworks, entry), true);
        }
        sign(dirname(dirname(app.resourcesDirectory)), true);
      }
      await verifyPackagedLanguageServers(app);

      // Prove that a missing copy rule or missing stub payload cannot produce a false pass.
      for (const missing of [
        'typescript/lib/lib.es5.d.ts',
        'pyright/dist/typeshed-fallback/stdlib/builtins.pyi',
        'pyright/dist/typeshed-fallback/stdlib/pathlib',
      ]) {
        const asset = join(app.resourcesDirectory, 'app.asar.unpacked/node_modules', missing);
        await rename(asset, `${asset}.missing`);
        try {
          await expect(verifyPackagedLanguageServers(app)).rejects.toThrow();
        } finally {
          await rename(`${asset}.missing`, asset);
        }
      }
    } finally {
      vi.unstubAllEnvs();
      await rm(root, { recursive: true, force: true });
    }
  },
  180_000
);
