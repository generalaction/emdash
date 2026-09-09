import { appendFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { Octokit } from '@octokit/rest';
import { GITHUB_OWNER, GITHUB_REPO, requireEnv } from './lib/config.ts';
import { fail, info, step } from './lib/log.ts';
import { releaseHasOwnership, releaseOwnershipMarker } from './lib/release-ownership.ts';
import { resolveReleaseVersion } from './lib/version.ts';
import type { ReleaseChannel } from './lib/version.ts';

const { values } = parseArgs({
  options: {
    channel: { type: 'string', default: 'stable' },
  },
  strict: true,
});

const channel = (values.channel ?? 'stable') as ReleaseChannel;
if (!['stable', 'canary'].includes(channel)) {
  fail(`Unknown channel "${channel}"; must be "stable" or "canary"`);
}

const token = process.env.GH_TOKEN;
if (!token) fail('GH_TOKEN env var is required');
const ownership = {
  runId: requireEnv('GITHUB_RUN_ID'),
  sha: requireEnv('GITHUB_SHA'),
};

const { tag, isCanary } = resolveReleaseVersion(channel);
const octokit = new Octokit({ auth: token });

step(`Ensuring single draft release for ${tag} (channel: ${channel})`);

const releases = await octokit.paginate(octokit.rest.repos.listReleases, {
  owner: GITHUB_OWNER,
  repo: GITHUB_REPO,
  per_page: 100,
});

const sameTag = releases.filter((r) => r.tag_name === tag);
if (sameTag.some((r) => !r.draft)) {
  fail(
    `A published release already exists for ${tag}; aborting to avoid overwriting a shipped release`
  );
}

const drafts = sameTag.filter((r) => r.draft);
if (drafts.length > 1) {
  const ids = drafts.map((r) => r.id).join(', ');
  fail(
    `Multiple draft releases already exist for ${tag} (ids: ${ids}); clean them up before re-running`
  );
}

let releaseId: number;
if (drafts.length === 1) {
  if (!releaseHasOwnership(drafts[0].body, ownership)) {
    fail(
      `Draft release ${tag} (id: ${drafts[0].id}) belongs to another workflow run or commit; ` +
        'rerun the workflow that created it or remove the stale draft explicitly'
    );
  }
  if (drafts[0].target_commitish !== ownership.sha) {
    fail(`Draft release ${tag} targets ${drafts[0].target_commitish}, expected ${ownership.sha}`);
  }
  releaseId = drafts[0].id;
  info(`Reusing existing draft release ${tag} (id: ${releaseId})`);
} else {
  const { data } = await octokit.rest.repos.createRelease({
    owner: GITHUB_OWNER,
    repo: GITHUB_REPO,
    tag_name: tag,
    name: tag,
    draft: true,
    prerelease: isCanary,
    target_commitish: ownership.sha,
    body: releaseOwnershipMarker(ownership),
  });
  releaseId = data.id;
  info(`Created draft release ${tag} (id: ${releaseId})`);
}

// Emit the release id to GITHUB_OUTPUT for observability in downstream steps.
const outputFile = process.env.GITHUB_OUTPUT;
if (outputFile) {
  appendFileSync(outputFile, `release_id=${releaseId}\n`);
}
