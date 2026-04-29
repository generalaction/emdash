import type { ScmProvider } from '@shared/automations/events';
import { gitRemoteToUrl } from '@shared/git-remote-url';
import { listProjectScmTargets } from '@main/core/automations/pollers/scm-helpers';

export type ScmIssueRef = {
  owner: string;
  repo: string;
  number: number;
};

const REF_WITH_REPO_RE = /^([^/\s]+)\/([^#\s]+)#(\d+)$/;
const REF_NUMBER_ONLY_RE = /^#?(\d+)$/;

/**
 * Parse a user-provided issue/PR reference. Accepted forms:
 *   "owner/repo#123" — fully qualified
 *   "#123" or "123"  — number only; owner/repo derived from the project's first matching remote
 */
export async function resolveScmIssueRef(
  ref: string,
  projectId: string,
  provider: ScmProvider
): Promise<ScmIssueRef | { error: string }> {
  const trimmed = ref.trim();
  if (!trimmed) return { error: 'ref_empty' };

  const fullMatch = REF_WITH_REPO_RE.exec(trimmed);
  if (fullMatch) {
    return { owner: fullMatch[1], repo: fullMatch[2], number: Number(fullMatch[3]) };
  }

  const numberMatch = REF_NUMBER_ONLY_RE.exec(trimmed);
  if (!numberMatch) {
    return { error: `ref_invalid:${trimmed}` };
  }
  const number = Number(numberMatch[1]);

  const targets = await listProjectScmTargets(projectId, provider);
  if (targets.length === 0) {
    return { error: `no_${provider}_remote_for_project` };
  }

  if (provider === 'github') {
    const target = targets.find((t) => t.nameWithOwner);
    if (!target?.nameWithOwner) return { error: 'github_remote_missing_name_with_owner' };
    const [owner, repo] = target.nameWithOwner.split('/', 2);
    return { owner, repo, number };
  }

  const url = targets[0].remoteUrl;
  const slug = parsePathSlug(url);
  if (!slug) return { error: `cannot_parse_${provider}_remote_url:${url}` };
  return { owner: slug.owner, repo: slug.repo, number };
}

/**
 * Resolve a target string for issue.create (no number). Same fallbacks as
 * resolveScmIssueRef but produces just owner/repo.
 */
export async function resolveScmTarget(
  target: string | undefined,
  projectId: string,
  provider: ScmProvider
): Promise<{ owner: string; repo: string } | { error: string }> {
  if (target) {
    const trimmed = target.trim();
    const slashIdx = trimmed.indexOf('/');
    if (slashIdx <= 0 || slashIdx === trimmed.length - 1) {
      return { error: `target_invalid:${trimmed}` };
    }
    return { owner: trimmed.slice(0, slashIdx), repo: trimmed.slice(slashIdx + 1) };
  }

  const targets = await listProjectScmTargets(projectId, provider);
  if (targets.length === 0) {
    return { error: `no_${provider}_remote_for_project` };
  }

  if (provider === 'github') {
    const found = targets.find((t) => t.nameWithOwner);
    if (!found?.nameWithOwner) return { error: 'github_remote_missing_name_with_owner' };
    const [owner, repo] = found.nameWithOwner.split('/', 2);
    return { owner, repo };
  }

  const url = targets[0].remoteUrl;
  const slug = parsePathSlug(url);
  if (!slug) return { error: `cannot_parse_${provider}_remote_url:${url}` };
  return slug;
}

function parsePathSlug(url: string): { owner: string; repo: string } | null {
  const normalized = gitRemoteToUrl(url) ?? url;
  let path: string;
  try {
    path = new URL(normalized).pathname;
  } catch {
    return null;
  }
  const cleaned = path.replace(/^\/+|\/+$/g, '');
  const parts = cleaned.split('/');
  if (parts.length < 2) return null;
  const owner = parts[0];
  const repo = parts.slice(1).join('/');
  if (!owner || !repo) return null;
  return { owner, repo };
}
