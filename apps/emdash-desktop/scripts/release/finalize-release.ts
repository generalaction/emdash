import { readFileSync } from 'node:fs';
import { Octokit } from '@octokit/rest';
import { fail, info, step, warn } from './lib/log.ts';

const token = process.env.GH_TOKEN;
if (!token) fail('GH_TOKEN env var is required');

const pkg = JSON.parse(readFileSync('package.json', 'utf-8')) as { version: string };
const tag = `v${pkg.version}`;

const octokit = new Octokit({ auth: token });

const OWNER = 'generalaction';
const REPO = 'emdash';

step(`Looking for draft release with tag ${tag}`);
const { data: releases } = await octokit.rest.repos.listReleases({
  owner: OWNER,
  repo: REPO,
  per_page: 30,
});

const draft = releases.find((r) => r.tag_name === tag && r.draft);
if (!draft) {
  warn(
    `Available releases: ${releases.map((r) => `${r.tag_name}(draft=${r.draft})`).join(', ')}`,
  );
  fail(`No draft release found for tag ${tag}`);
}

step(`Publishing release ${tag} (id: ${draft.id})`);
await octokit.rest.repos.updateRelease({
  owner: OWNER,
  repo: REPO,
  release_id: draft.id,
  draft: false,
});

info(`Release ${tag} is now published on GitHub`);
