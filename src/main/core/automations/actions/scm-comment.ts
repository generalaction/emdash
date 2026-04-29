import { issueCreateComment } from '@llamaduck/forgejo-ts';
import type { ScmProvider } from '@shared/automations/events';
import { err, ok, type Result } from '@shared/result';
import { forgejoConnectionService } from '@main/core/forgejo/forgejo-connection-service';
import { getOctokit } from '@main/core/github/services/octokit-provider';
import { gitLabConnectionService } from '@main/core/gitlab/gitlab-connection-service';
import { resolveScmIssueRef } from './scm-ref';
import type { ActionOutcome } from './types';

type ScmCommentKind = 'issue' | 'pr';

export async function postScmComment(
  provider: ScmProvider,
  projectId: string,
  ref: string,
  body: string,
  kind: ScmCommentKind
): Promise<Result<ActionOutcome, string>> {
  const resolved = await resolveScmIssueRef(ref, projectId, provider);
  if ('error' in resolved) return err(resolved.error);
  const { owner, repo, number } = resolved;

  if (provider === 'github') {
    const octokit = await getOctokit();
    const { data } = await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: number,
      body,
    });
    return ok({ message: `Comment posted at ${data.html_url}` });
  }

  if (provider === 'gitlab') {
    const client = await gitLabConnectionService.getClient();
    if (!client) return err('gitlab_not_configured');
    if (kind === 'pr') {
      const created = (await client.MergeRequestNotes.create(`${owner}/${repo}`, number, body)) as {
        id?: number;
      };
      return ok({
        message: `Comment ${created.id ?? ''} posted on ${owner}/${repo} MR !${number}`,
      });
    }
    const created = (await client.IssueNotes.create(`${owner}/${repo}`, number, body)) as {
      id?: number;
    };
    return ok({ message: `Comment ${created.id ?? ''} posted on ${owner}/${repo}#${number}` });
  }

  const client = await forgejoConnectionService.getClient();
  if (!client) return err('forgejo_not_configured');
  const { data } = await issueCreateComment({
    client,
    path: { owner, repo, index: number },
    body: { body },
    throwOnError: true,
  });
  return ok({
    message: data?.html_url
      ? `Comment posted at ${data.html_url}`
      : `Comment posted on ${owner}/${repo}#${number}`,
  });
}
