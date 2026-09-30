import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LinuxTargetHelper } from 'app-builder-lib/out/targets/LinuxTargetHelper';
import { AppInfo, LinuxPackager, Packager } from 'electron-builder';
import { describe, expect, it } from 'vitest';
import canaryConfig from '../../../electron-builder.canary.config.ts';
import stableConfig from '../../../electron-builder.config.ts';
import packageJson from '../../../package.json';
import { createReleaseBuildConfig } from './build-config.ts';

const packageFile = fileURLToPath(new URL('../../../package.json', import.meta.url));
const projectDir = dirname(packageFile);

describe.each([
  { channel: 'stable', baseConfig: stableConfig, desktopId: 'Emdash', productName: 'Emdash' },
  {
    channel: 'canary',
    baseConfig: canaryConfig,
    desktopId: 'emdash-canary',
    productName: 'Emdash Canary',
  },
])('$channel Linux desktop identity', ({ channel, baseConfig, desktopId, productName }) => {
  it.each(['local', 'release'])('matches the %s launcher on Wayland and X11', async (mode) => {
    const versionOverride =
      mode === 'release' && channel === 'canary' ? '9.9.9-canary.123' : undefined;
    const config =
      mode === 'release'
        ? createReleaseBuildConfig(
            baseConfig,
            packageJson.devDependencies.electron,
            versionOverride
          )
        : structuredClone(baseConfig);
    const packager = new Packager({ projectDir, config });
    await packager.validateConfig();
    packager._appInfo = new AppInfo(packager, null);
    const linuxPackager = new LinuxPackager(packager);
    // Exercise the builder's desktop generator and merged package metadata without
    // downloading Electron or invoking native Linux packaging tools.
    const helper = new LinuxTargetHelper(linuxPackager);
    const desktopEntry = await helper.computeDesktopEntry(
      linuxPackager.platformSpecificBuildOptions
    );
    const metadata = packager.metadata;

    expect(metadata.desktopName).toBe(`${desktopId}.desktop`);
    expect(helper.getDesktopFileName()).toBe(desktopId);
    expect(helper.getDesktopFileName('different-executable')).toBe(desktopId);
    expect(metadata.desktopName).toBe(`${helper.getDesktopFileName()}.desktop`);
    expect(desktopEntry).toContain(`\nStartupWMClass=${productName}\n`);
    expect(desktopEntry).toContain(`\nName=${productName}\n`);
    expect(config.productName).toBe(productName);
    expect(metadata.version).toBe(versionOverride ?? packageJson.version);
  });
});

describe('createReleaseBuildConfig', () => {
  it('isolates nested configuration between architecture builds', () => {
    const original = structuredClone(canaryConfig);
    const first = createReleaseBuildConfig(canaryConfig, packageJson.devDependencies.electron);
    const second = createReleaseBuildConfig(canaryConfig, packageJson.devDependencies.electron);

    expect(first.files).not.toBe(second.files);
    expect(first.extraMetadata).not.toBe(second.extraMetadata);
    expect(first.linux?.desktop?.entry).not.toBe(second.linux?.desktop?.entry);
    expect(canaryConfig).toEqual(original);
  });
});
