import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { Octokit } from '@octokit/rest';
import { Arch, Platform, build as electronBuild } from 'electron-builder';
import type { Configuration } from 'electron-builder';
import canaryConfig from '../../electron-builder.canary.config.ts';
import stableConfig from '../../electron-builder.config.ts';
import {
  duplicateChannelManifests,
  findManifests,
  mergeUpdateManifests,
  resolvePublishChannels,
} from './lib/artifacts.ts';
import { GITHUB_OWNER, GITHUB_REPO, requireEnv } from './lib/config.ts';
import { exec } from './lib/exec.ts';
import { fail, info, step, warn } from './lib/log.ts';
import { releaseHasOwnership } from './lib/release-ownership.ts';
import { resolveReleaseVersion } from './lib/version.ts';
import type { ReleaseChannel } from './lib/version.ts';

const { values } = parseArgs({
  options: {
    platform: { type: 'string' },
    arch: { type: 'string', default: 'both' },
    targets: { type: 'string' },
    config: { type: 'string', default: 'electron-builder.config.ts' },
    channel: { type: 'string', default: 'stable' },
    'release-id': { type: 'string' },
  },
  strict: true,
});

const platform = values.platform;
if (!platform || !['mac', 'linux', 'win'].includes(platform)) {
  fail(
    'Usage: build.ts --platform mac|linux|win [--arch arm64|x64|both] [--targets dmg,zip] [--config electron-builder.config.ts] [--channel stable|canary] [--release-id id]'
  );
}

const channel = (values.channel ?? 'stable') as ReleaseChannel;
if (!['stable', 'canary'].includes(channel)) {
  fail(`Unknown channel "${channel}"; must be "stable" or "canary"`);
}

const archInput = values.arch ?? 'both';
if (!['x64', 'arm64', 'both'].includes(archInput)) {
  fail(`Unknown arch: ${archInput}`);
}
const archs: Array<'x64' | 'arm64'> =
  archInput === 'both' ? ['x64', 'arm64'] : [archInput as 'x64' | 'arm64'];

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

const releaseId = Number(values['release-id']);
if (!Number.isSafeInteger(releaseId) || releaseId <= 0) {
  fail('--release-id must be a positive integer from prepare-release');
}
const ghToken = requireEnv('GH_TOKEN');
const octokit = new Octokit({ auth: ghToken });
const { data: draft } = await octokit.rest.repos.getRelease({
  owner: GITHUB_OWNER,
  repo: GITHUB_REPO,
  release_id: releaseId,
});
const ownership = {
  runId: requireEnv('GITHUB_RUN_ID'),
  sha: requireEnv('GITHUB_SHA'),
};
if (!draft.draft || draft.tag_name !== tag || !releaseHasOwnership(draft.body, ownership)) {
  fail(`Release ${releaseId} is not the owned ${tag} draft for this workflow run and commit`);
}
if (draft.target_commitish !== ownership.sha) {
  fail(`Release ${releaseId} targets ${draft.target_commitish}, expected ${ownership.sha}`);
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

const configName = basename(values.config ?? 'electron-builder.config.ts');
const baseConfig: Configuration =
  configName === 'electron-builder.config.ts'
    ? stableConfig
    : configName === 'electron-builder.canary.config.ts'
      ? canaryConfig
      : fail(`Unknown electron-builder config "${configName}"`);
const publishArray = Array.isArray(baseConfig.publish)
  ? baseConfig.publish
  : baseConfig.publish
    ? [baseConfig.publish]
    : [];
const { githubChannel, r2Channel } = resolvePublishChannels(
  publishArray as Array<Record<string, unknown>>
);
const collectedManifests = new Map<string, string[]>();

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
      // Platform verification and notarization must run against the exact bytes that ship.
      // A later explicit step uploads those final files to the owned GitHub draft.
      publish: 'never',
    });

    for (const manifest of findManifests(githubChannel, join(deployDir, 'release'))) {
      const name = basename(manifest);
      const versions = collectedManifests.get(name) ?? [];
      versions.push(readFileSync(manifest, 'utf8'));
      collectedManifests.set(name, versions);
    }

    info(`Built ${platform} ${targetList.join(' ')} for ${arch}`);
  }

  for (const [name, manifests] of collectedManifests) {
    writeFileSync(join(deployDir, 'release', name), mergeUpdateManifests(manifests));
  }

  step('Copying release artifacts to app directory');
  rmSync('release', { recursive: true, force: true });
  cpSync(join(deployDir, 'release'), 'release', { recursive: true });

  step('Preparing GitHub and R2 channel manifests');
  const generatedManifests = findManifests(githubChannel);
  if (r2Channel && githubChannel !== r2Channel) {
    const duplicated = duplicateChannelManifests(githubChannel, r2Channel);
    if (duplicated.length > 0) {
      info(`Duplicated ${duplicated.length} manifest(s): "${githubChannel}" → "${r2Channel}"`);
      generatedManifests.push(...duplicated);
    } else {
      warn(`No "${githubChannel}" manifests found to duplicate for R2 channel "${r2Channel}"`);
    }
  }
  info(
    `Prepared ${generatedManifests.length} local update manifest(s) for post-verification upload`
  );
} finally {
  rmSync(deployDir, { recursive: true, force: true });
}
