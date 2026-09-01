import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { parseArgs } from 'node:util';
import { Octokit } from '@octokit/rest';
import { S3mini } from 's3mini';
import {
  updateManifestFiles,
  updateManifestVersion,
  versionUpdateManifestUrls,
} from './lib/artifacts.ts';
import { GITHUB_OWNER, GITHUB_REPO, r2Endpoint, requireEnv } from './lib/config.ts';
import { fail, info, step, warn } from './lib/log.ts';
import {
  PromotionCommitUncertainError,
  promoteObjectsWithRollback,
  restorePromotionSnapshot,
  snapshotPromotionObjects,
} from './lib/object-promotion.ts';
import type { ObjectPromotionStore } from './lib/object-promotion.ts';
import { parsePromotionJournal, serializePromotionJournal } from './lib/promotion-journal.ts';
import {
  expectedManifestFiles,
  expectedReleaseAssets,
  findMissingReleaseAssets,
  forbiddenReleaseAssets,
  isReleaseArch,
  releaseIdentity,
} from './lib/release-assets.ts';
import type { ReleaseArch } from './lib/release-assets.ts';
import { releaseHasOwnership } from './lib/release-ownership.ts';
import { resolveReleaseVersion } from './lib/version.ts';
import type { ReleaseChannel } from './lib/version.ts';

const { values } = parseArgs({
  options: {
    channel: { type: 'string', default: 'stable' },
    arch: { type: 'string', default: 'both' },
    'release-id': { type: 'string' },
  },
  strict: true,
});

const channel = (values.channel ?? 'stable') as ReleaseChannel;
if (!['stable', 'canary'].includes(channel)) {
  fail(`Unknown channel "${channel}"; must be "stable" or "canary"`);
}

const token = requireEnv('GH_TOKEN');
if (!values['release-id']) {
  await finalizeLegacyRelease(channel, token);
  process.exit(0);
}

const archInput = values.arch ?? 'both';
if (!isReleaseArch(archInput)) {
  fail(`Unknown architecture "${archInput}"; must be "arm64", "x64", or "both"`);
}
if (archInput !== 'both') {
  fail('Public releases must contain the complete x64 and arm64 architecture set');
}
const arch: ReleaseArch = archInput;

const releaseId = Number(values['release-id']);
if (!Number.isSafeInteger(releaseId) || releaseId <= 0) {
  fail('--release-id must be a positive integer from prepare-release');
}

const ownership = {
  runId: requireEnv('GITHUB_RUN_ID'),
  sha: requireEnv('GITHUB_SHA'),
};
const runAttempt = requireEnv('GITHUB_RUN_ATTEMPT');
if (!/^\d+$/.test(runAttempt)) fail(`Invalid GitHub run attempt: ${runAttempt}`);

const { version, tag, isCanary } = resolveReleaseVersion(channel);
if (basename(tag) !== tag || !/^[A-Za-z0-9._-]+$/.test(tag)) {
  fail(`Release tag cannot be used as an R2 prefix: ${tag}`);
}
const immutablePrefix = `releases/${tag}/${ownership.runId}-${runAttempt}`;
const octokit = new Octokit({ auth: token });

step(`Loading owned release ${releaseId} for ${tag}`);
const { data: release } = await octokit.rest.repos.getRelease({
  owner: GITHUB_OWNER,
  repo: GITHUB_REPO,
  release_id: releaseId,
});
if (release.tag_name !== tag || !releaseHasOwnership(release.body, ownership)) {
  fail(`Release ${releaseId} is not the owned ${tag} release for this workflow run and commit`);
}
if (release.target_commitish !== ownership.sha) {
  fail(`Release ${releaseId} targets ${release.target_commitish}, expected ${ownership.sha}`);
}
if (!release.draft && release.prerelease !== isCanary) {
  fail(`Published release ${releaseId} has an unexpected prerelease state`);
}

step(`Verifying release assets and update manifests for ${arch}`);
const assets = await octokit.paginate(octokit.rest.repos.listReleaseAssets, {
  owner: GITHUB_OWNER,
  repo: GITHUB_REPO,
  release_id: releaseId,
  per_page: 100,
});
const assetNames = assets.map((asset) => asset.name);
const assetNameSet = new Set(assetNames);
const expectedAssets = expectedReleaseAssets(channel, arch);
const missingAssets = findMissingReleaseAssets(assetNames, expectedAssets);
if (missingAssets.length > 0) {
  fail(`Refusing to publish ${tag}; missing release assets:\n${missingAssets.join('\n')}`);
}
const forbidden = forbiddenReleaseAssets(channel, arch).filter((name) => assetNameSet.has(name));
if (forbidden.length > 0) {
  fail(
    `Refusing to publish ${tag}; found assets for an unselected architecture:\n${forbidden.join('\n')}`
  );
}

const assetByName = new Map(assets.map((asset) => [asset.name, asset]));
const manifestContents = new Map<string, string>();
const manifestMetadata = new Map<string, { sha512: string; size?: number }>();
const { artifactPrefix, r2Channel } = releaseIdentity(channel);
for (const [manifestName, requiredFiles] of expectedManifestFiles(channel, arch)) {
  const asset = assetByName.get(manifestName);
  if (!asset) fail(`Missing update manifest asset: ${manifestName}`);
  const content = new TextDecoder().decode(await downloadAsset(asset.url, token));
  if (updateManifestVersion(content) !== version) {
    fail(`${manifestName} has version ${updateManifestVersion(content)}, expected ${version}`);
  }
  const manifestFiles = updateManifestFiles(content);
  const files = new Set(manifestFiles.map((file) => file.url));
  const requiredFileSet = new Set(requiredFiles);
  const missingFiles = requiredFiles.filter((file) => !files.has(file));
  const unexpectedFiles = [...files].filter((file) => !requiredFileSet.has(file));
  if (missingFiles.length > 0 || unexpectedFiles.length > 0) {
    fail(
      `${manifestName} file set mismatch (missing: ${missingFiles.join(', ') || 'none'}; ` +
        `unexpected: ${unexpectedFiles.join(', ') || 'none'})`
    );
  }
  for (const file of manifestFiles) {
    if (
      basename(file.url) !== file.url ||
      !file.url.startsWith(`${artifactPrefix}-`) ||
      file.url.endsWith('.yml') ||
      !assetNameSet.has(file.url)
    ) {
      fail(`${manifestName} references an unavailable release artifact: ${file.url}`);
    }
    const existingMetadata = manifestMetadata.get(file.url);
    if (
      existingMetadata &&
      (existingMetadata.sha512 !== file.sha512 || existingMetadata.size !== file.size)
    ) {
      fail(`${manifestName} conflicts with another manifest entry for ${file.url}`);
    }
    manifestMetadata.set(file.url, { sha512: file.sha512, size: file.size });
  }
  manifestContents.set(manifestName, content);
}
info(`Verified ${expectedAssets.length} release assets and ${manifestContents.size} manifests`);

const r2Manifests = [...manifestContents].filter(([name]) =>
  new RegExp(`^${escapeRegExp(r2Channel)}(?:-|\\.)`).test(name)
);
const immutableAssets = assets.filter(
  (asset) => asset.name.startsWith(`${artifactPrefix}-`) && !asset.name.endsWith('.yml')
);
if (immutableAssets.length === 0) fail('No installer assets found to stage in R2');

const s3 = new S3mini({
  accessKeyId: requireEnv('R2_ACCESS_KEY_ID'),
  secretAccessKey: requireEnv('R2_SECRET_ACCESS_KEY'),
  endpoint: r2Endpoint(),
  region: 'auto',
});
const r2RootStore: ObjectPromotionStore<string> = {
  read: (key) => s3.getObject(key),
  write: async (key, value) => {
    await s3.putObject(key, value, 'application/yaml');
    info(`Wrote ${key}`);
  },
  remove: async (key) => {
    if (!(await s3.deleteObject(key))) throw new Error(`Failed to remove R2 object ${key}`);
  },
};
const journalIdentity = { tag, runId: ownership.runId, sha: ownership.sha };
const journalKey = `release-transactions/${tag}/${ownership.runId}/root-manifests.json`;
const rootEntries = r2Manifests.map(([key]) => ({ key, value: '' }));
const rootKeys = rootEntries.map(({ key }) => key);
const existingJournal = await s3.getObject(journalKey);
let rollbackSnapshot: Map<string, string | null>;
if (existingJournal === null) {
  rollbackSnapshot = await snapshotPromotionObjects(rootEntries, r2RootStore);
  await s3.putObject(
    journalKey,
    serializePromotionJournal(journalIdentity, rollbackSnapshot, rootKeys),
    'application/json'
  );
  info(`Persisted original R2 root snapshot at ${journalKey}`);
} else {
  rollbackSnapshot = parsePromotionJournal(existingJournal, journalIdentity, rootKeys);
  info(`Loaded original R2 root snapshot from ${journalKey}`);
  if (release.draft) {
    step('Restoring the last public R2 roots before retrying the draft release');
    await restorePromotionSnapshot(rootEntries, r2RootStore, rollbackSnapshot);
  }
}

step(`Staging ${immutableAssets.length} immutable R2 artifacts under ${immutablePrefix}`);
const checksumVerified = new Set<string>();
for (const asset of immutableAssets) {
  const data = await downloadAsset(asset.url, token);
  const expectedMetadata = manifestMetadata.get(asset.name);
  if (expectedMetadata) {
    const actualChecksum = createHash('sha512').update(data).digest('base64');
    if (actualChecksum !== expectedMetadata.sha512) {
      fail(`Checksum mismatch for ${asset.name}; refusing to promote updater manifests`);
    }
    if (expectedMetadata.size !== undefined && data.byteLength !== expectedMetadata.size) {
      fail(`Size mismatch for ${asset.name}; refusing to promote updater manifests`);
    }
    checksumVerified.add(asset.name);
  }
  await s3.putObject(`${immutablePrefix}/${asset.name}`, data, 'application/octet-stream');
  info(`Staged ${asset.name}`);
}
const uncheckedManifestAssets = [...manifestMetadata.keys()].filter(
  (name) => !checksumVerified.has(name)
);
if (uncheckedManifestAssets.length > 0) {
  fail(`Manifest assets were not checksum-verified: ${uncheckedManifestAssets.join(', ')}`);
}

const promotedManifests = r2Manifests.map(([name, content]) => ({
  key: name,
  value: versionUpdateManifestUrls(content, immutablePrefix, assetNameSet),
}));

step(`Promoting ${promotedManifests.length} validated R2 update manifests`);
await promoteObjectsWithRollback(
  promotedManifests,
  r2RootStore,
  async () => {
    if (!release.draft) {
      info(`Release ${tag} was already published; reconciled every R2 channel manifest`);
      return;
    }

    step(`Publishing GitHub release ${tag} (id: ${releaseId}, prerelease: ${isCanary})`);
    try {
      await octokit.rest.repos.updateRelease({
        owner: GITHUB_OWNER,
        repo: GITHUB_REPO,
        release_id: releaseId,
        draft: false,
        prerelease: isCanary,
      });
    } catch (publishError) {
      try {
        const { data: current } = await octokit.rest.repos.getRelease({
          owner: GITHUB_OWNER,
          repo: GITHUB_REPO,
          release_id: releaseId,
        });
        if (!current.draft) {
          if (
            current.tag_name !== tag ||
            current.prerelease !== isCanary ||
            !releaseHasOwnership(current.body, ownership)
          ) {
            throw new PromotionCommitUncertainError(
              `Release ${releaseId} became public with unexpected metadata; manual reconciliation required`
            );
          }
          info(`Confirmed release ${tag} was published despite the failed API response`);
          return;
        }
      } catch (inspectionError) {
        if (inspectionError instanceof PromotionCommitUncertainError) throw inspectionError;
        throw new PromotionCommitUncertainError(
          `Could not determine whether GitHub published ${tag}; retained the complete promoted ` +
            `R2 manifest set for a safe retry (${String(inspectionError)})`
        );
      }
      throw publishError;
    }
  },
  { rollbackSnapshot }
);

if (!(await s3.deleteObject(journalKey))) {
  throw new Error(`Release succeeded but failed to remove R2 promotion journal ${journalKey}`);
}
info(`Removed completed R2 promotion journal ${journalKey}`);

info(`Release ${tag} is published and its R2 channels point to immutable artifacts`);

async function downloadAsset(url: string, authToken: string): Promise<Uint8Array> {
  const response = await fetch(url, {
    headers: {
      accept: 'application/octet-stream',
      authorization: `Bearer ${authToken}`,
      'x-github-api-version': '2022-11-28',
    },
  });
  if (!response.ok) fail(`Failed to download release asset: HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Preserves the current finalization behavior until the workflow migration starts passing an exact
 * release id. Remove this compatibility path in the workflow migration commit.
 */
async function finalizeLegacyRelease(releaseChannel: ReleaseChannel, authToken: string) {
  const { tag: releaseTag, isCanary: releaseIsCanary } = resolveReleaseVersion(releaseChannel);
  const legacyOctokit = new Octokit({ auth: authToken });

  step(`Looking for draft release with tag ${releaseTag} (channel: ${releaseChannel})`);
  const { data: releases } = await legacyOctokit.rest.repos.listReleases({
    owner: GITHUB_OWNER,
    repo: GITHUB_REPO,
    per_page: 100,
  });
  const drafts = releases.filter(
    (candidate) => candidate.tag_name === releaseTag && candidate.draft
  );
  if (drafts.length === 0) {
    const summary = releases
      .map((candidate) => `${candidate.tag_name}(draft=${String(candidate.draft)})`)
      .join(', ');
    warn(`Available releases: ${summary}`);
    fail(`No draft release found for tag ${releaseTag}`);
  }
  if (drafts.length > 1) {
    const ids = drafts.map((candidate) => String(candidate.id)).join(', ');
    fail(
      `Multiple draft releases found for tag ${releaseTag} (ids: ${ids}); ` +
        'prepare-release should have prevented this. Clean them up before retrying.'
    );
  }

  const draft = drafts[0];
  step(`Publishing release ${releaseTag} (id: ${draft.id}, prerelease: ${releaseIsCanary})`);
  await legacyOctokit.rest.repos.updateRelease({
    owner: GITHUB_OWNER,
    repo: GITHUB_REPO,
    release_id: draft.id,
    draft: false,
    prerelease: releaseIsCanary,
  });
  info(`Release ${releaseTag} is now published on GitHub`);
}
