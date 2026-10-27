import { createHash } from 'node:crypto';
import { createReadStream, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parseArgs } from 'node:util';
import { Octokit } from '@octokit/rest';
import { refreshUpdateManifestMetadata, updateManifestFileUrls } from './lib/artifacts.ts';
import type { ArtifactFileMetadata } from './lib/artifacts.ts';
import { GITHUB_OWNER, GITHUB_REPO, RELEASE_DIR, requireEnv } from './lib/config.ts';
import { fail, info, step } from './lib/log.ts';
import { isPlatformReleaseAsset, releaseIdentity } from './lib/release-assets.ts';
import type { ReleasePlatform } from './lib/release-assets.ts';
import { releaseHasOwnership } from './lib/release-ownership.ts';
import { resolveReleaseVersion } from './lib/version.ts';
import type { ReleaseChannel } from './lib/version.ts';

const { values } = parseArgs({
  options: {
    platform: { type: 'string' },
    channel: { type: 'string', default: 'stable' },
    'release-id': { type: 'string' },
  },
  strict: true,
});

const platformInput = values.platform;
if (!platformInput || !['linux', 'mac', 'win'].includes(platformInput)) {
  fail('--platform must be linux, mac, or win');
}
const platform = platformInput as ReleasePlatform;

const channel = (values.channel ?? 'stable') as ReleaseChannel;
if (!['stable', 'canary'].includes(channel)) {
  fail(`Unknown channel "${channel}"; must be "stable" or "canary"`);
}

const releaseId = Number(values['release-id']);
if (!Number.isSafeInteger(releaseId) || releaseId <= 0) {
  fail('--release-id must be a positive integer from prepare-release');
}

const token = requireEnv('GH_TOKEN');
const ownership = {
  runId: requireEnv('GITHUB_RUN_ID'),
  sha: requireEnv('GITHUB_SHA'),
};
const { tag } = resolveReleaseVersion(channel);
const octokit = new Octokit({ auth: token });

step(`Loading owned draft release ${releaseId} for ${tag}`);
const { data: draft } = await octokit.rest.repos.getRelease({
  owner: GITHUB_OWNER,
  repo: GITHUB_REPO,
  release_id: releaseId,
});
if (!draft.draft || draft.tag_name !== tag || !releaseHasOwnership(draft.body, ownership)) {
  fail(`Release ${releaseId} is not the owned ${tag} draft for this workflow run and commit`);
}
if (draft.target_commitish !== ownership.sha) {
  fail(`Release ${releaseId} targets ${draft.target_commitish}, expected ${ownership.sha}`);
}

const localNames = readdirSync(RELEASE_DIR, { withFileTypes: true })
  .filter((entry) => entry.isFile() && isPlatformReleaseAsset(entry.name, channel, platform))
  .map((entry) => entry.name);
const manifestNames = localNames.filter((name) => name.endsWith('.yml'));
const artifactNames = localNames.filter((name) => !name.endsWith('.yml'));
if (artifactNames.length === 0) fail(`No ${platform} release artifacts found in ${RELEASE_DIR}/`);

const { githubChannel, r2Channel } = releaseIdentity(channel);
for (const manifestChannel of [githubChannel, r2Channel]) {
  if (!manifestNames.some((name) => name.startsWith(manifestChannel))) {
    fail(`No ${platform} ${manifestChannel} update manifest found in ${RELEASE_DIR}/`);
  }
}

step(`Hashing ${artifactNames.length} final ${platform} artifact(s)`);
const metadataByName = new Map<string, ArtifactFileMetadata>();
for (const name of artifactNames) {
  metadataByName.set(name, await computeFileMetadata(join(RELEASE_DIR, name)));
}

step(`Refreshing ${manifestNames.length} manifest(s) from final artifact bytes`);
for (const name of manifestNames) {
  const file = join(RELEASE_DIR, name);
  const content = readFileSync(file, 'utf8');
  for (const referencedName of updateManifestFileUrls(content)) {
    if (basename(referencedName) !== referencedName || !metadataByName.has(referencedName)) {
      fail(`${name} references a non-local or unavailable ${platform} artifact: ${referencedName}`);
    }
  }
  writeFileSync(file, refreshUpdateManifestMetadata(content, metadataByName));
}

const existingAssets = await octokit.paginate(octokit.rest.repos.listReleaseAssets, {
  owner: GITHUB_OWNER,
  repo: GITHUB_REPO,
  release_id: releaseId,
  per_page: 100,
});
const existingByName = new Map(existingAssets.map((asset) => [asset.name, asset]));
const uploadNames = [...artifactNames.sort(), ...manifestNames.sort()];

step(`Uploading ${uploadNames.length} verified ${platform} release file(s) to draft ${tag}`);
for (const name of uploadNames) {
  const existing = existingByName.get(name);
  if (existing) {
    await octokit.rest.repos.deleteReleaseAsset({
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
      asset_id: existing.id,
    });
  }

  const file = join(RELEASE_DIR, name);
  const data = readFileSync(file);
  await octokit.rest.repos.uploadReleaseAsset({
    owner: GITHUB_OWNER,
    repo: GITHUB_REPO,
    release_id: releaseId,
    name,
    // Octokit's generated type says string, but its request layer accepts Buffer for binary assets.
    data: data as unknown as string,
    headers: {
      'content-type': name.endsWith('.yml') ? 'application/yaml' : 'application/octet-stream',
      'content-length': data.byteLength,
    },
  });
  info(`Uploaded ${name}`);
}

info(`Uploaded final ${platform} artifacts and manifests to owned draft ${tag}`);

async function computeFileMetadata(file: string): Promise<ArtifactFileMetadata> {
  const hash = createHash('sha512');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return { sha512: hash.digest('base64'), size: statSync(file).size };
}
