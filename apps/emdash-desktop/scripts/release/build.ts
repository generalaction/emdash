import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { Arch, Platform, build as electronBuild } from 'electron-builder';
import type { Configuration } from 'electron-builder';
import { exec } from './lib/exec.ts';
import { fail, info, step } from './lib/log.ts';
import { resolveReleaseVersion } from './lib/version.ts';
import type { ReleaseChannel } from './lib/version.ts';

const { values } = parseArgs({
  options: {
    platform: { type: 'string' },
    arch: { type: 'string', default: 'both' },
    targets: { type: 'string' },
    config: { type: 'string', default: 'electron-builder.config.ts' },
    channel: { type: 'string', default: 'stable' },
  },
  strict: true,
});

const platform = values.platform;
if (!platform || !['mac', 'linux', 'win'].includes(platform)) {
  fail(
    'Usage: build.ts --platform mac|linux|win [--arch arm64|x64|both] [--targets dmg,zip] [--config electron-builder.config.ts] [--channel stable|canary]'
  );
}

const channel = (values.channel ?? 'stable') as ReleaseChannel;
if (!['stable', 'canary'].includes(channel)) {
  fail(`Unknown channel "${channel}"; must be "stable" or "canary"`);
}

const archInput = values.arch ?? 'both';
const archs: string[] = archInput === 'both' ? ['x64', 'arm64'] : [archInput];

const defaultTargets: Record<string, string[]> = {
  mac: ['dmg', 'zip'],
  linux: ['AppImage', 'deb', 'rpm'],
  win: ['nsis', 'msi'],
};
const targetList = values.targets ? values.targets.split(',') : defaultTargets[platform];

const platformMap: Record<string, Platform> = {
  mac: Platform.MAC,
  linux: Platform.LINUX,
  win: Platform.WINDOWS,
};

const archMap: Record<string, Arch> = {
  x64: Arch.x64,
  arm64: Arch.arm64,
};

const ebPlatform = platformMap[platform];

const { version: overrideVersion, tag, isCanary } = resolveReleaseVersion(channel);
if (isCanary) {
  info(`Canary build: packaging as version ${overrideVersion} (tag ${tag})`);
}

step('Creating deployment directory with production dependencies');
const workspaceRoot = resolve(process.cwd(), '../..');
const deployDir = mkdtempSync(join(workspaceRoot, '.emdash-deploy-'));
exec(`pnpm --filter @emdash/emdash-desktop deploy --legacy --prod ${deployDir}`, {
  cwd: workspaceRoot,
  echo: true,
});

step('Copying built assets into deployment directory');
cpSync('out', join(deployDir, 'out'), { recursive: true });
cpSync('drizzle', join(deployDir, 'drizzle'), { recursive: true });

const electronVersion = exec(`node -p "require('electron/package.json').version"`);

// Dynamically load the electron-builder config (TypeScript stripping via --experimental-strip-types).
// Use a file:// URL so absolute Windows paths (e.g. D:\...) are not parsed as a URL scheme.
const configModule = await import(pathToFileURL(resolve(values.config)).href);
const baseConfig = (configModule.default ?? configModule) as Configuration;

try {
  for (const arch of archs) {
    step(`Building ${platform} ${targetList.join(' ')} for ${arch}`);

    exec(
      `node --experimental-strip-types scripts/release/rebuild-native.ts --arch ${arch} --deploy-dir ${deployDir}`,
      { echo: true }
    );

    const archEnum = archMap[arch];
    if (!archEnum) fail(`Unknown arch: ${arch}`);

    const buildTargets = ebPlatform.createTarget(targetList, archEnum);
    // Clone per iteration: electron-builder's normalizeFiles mutates config.files in
    // place (collapsing strings into a single fileset and leaving null holes), which
    // crashes the second arch iteration if the same config object is reused.
    const config: Configuration = {
      ...structuredClone(baseConfig),
      electronVersion,
      npmRebuild: false,
      ...(isCanary ? { extraMetadata: { version: overrideVersion } } : {}),
    };

    await electronBuild({
      targets: buildTargets,
      config,
      projectDir: deployDir,
      publish: 'always',
    });

    info(`Built ${platform} ${targetList.join(' ')} for ${arch}`);
  }

  step('Copying release artifacts to app directory');
  cpSync(join(deployDir, 'release'), 'release', { recursive: true });
} finally {
  rmSync(deployDir, { recursive: true, force: true });
}
