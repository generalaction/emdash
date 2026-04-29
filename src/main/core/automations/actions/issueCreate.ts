import { issueCreateIssue } from '@llamaduck/forgejo-ts';
import type { IssueCreateAction } from '@shared/automations/actions';
import type { ScmProvider } from '@shared/automations/events';
import { err, ok, type Result } from '@shared/result';
import { forgejoConnectionService } from '@main/core/forgejo/forgejo-connection-service';
import { getOctokit } from '@main/core/github/services/octokit-provider';
import { gitLabConnectionService } from '@main/core/gitlab/gitlab-connection-service';
import { jiraConnectionService } from '@main/core/jira/jira-connection-service';
import { jiraPostJson, plainTextToAdf } from '@main/core/jira/jira-http';
import { linearConnectionService } from '@main/core/linear/linear-connection-service';
import { resolveScmTarget } from './scm-ref';
import { applyAutomationTemplate } from './template';
import type { ActionContext, ActionExecutor, ActionOutcome } from './types';

export const executeIssueCreate: ActionExecutor<IssueCreateAction> = async (action, ctx) => {
  const title = applyAutomationTemplate(action.title, ctx.event).trim();
  const body = applyAutomationTemplate(action.body, ctx.event);
  if (!title) return err('issue_create_title_empty');

  try {
    switch (action.provider) {
      case 'github':
      case 'gitlab':
      case 'forgejo':
        return await createScmIssue(action.provider, action, ctx, title, body);
      case 'jira':
        return await createJiraIssue(action, title, body);
      case 'linear':
        return await createLinearIssue(action, title, body);
      case 'plain':
        return err('plain_does_not_support_issue_create');
      default: {
        const exhaustive: never = action.provider;
        return err(`unknown_issue_provider:${exhaustive as string}`);
      }
    }
  } catch (error) {
    return err(error instanceof Error ? error.message : String(error));
  }
};

async function createScmIssue(
  provider: ScmProvider,
  action: IssueCreateAction,
  ctx: ActionContext,
  title: string,
  body: string
): Promise<Result<ActionOutcome, string>> {
  const resolved = await resolveScmTarget(action.target, ctx.automation.projectId, provider);
  if ('error' in resolved) return err(resolved.error);
  const { owner, repo } = resolved;

  if (provider === 'github') {
    const octokit = await getOctokit();
    const { data } = await octokit.rest.issues.create({
      owner,
      repo,
      title,
      body,
      labels: action.labels,
    });
    return ok({ message: `Issue created at ${data.html_url}` });
  }

  if (provider === 'gitlab') {
    const client = await gitLabConnectionService.getClient();
    if (!client) return err('gitlab_not_configured');
    const created = (await client.Issues.create(`${owner}/${repo}`, title, {
      description: body,
      labels: action.labels?.join(','),
    })) as { web_url?: string; iid?: number };
    return ok({
      message: created.web_url
        ? `Issue created at ${created.web_url}`
        : `Issue #${created.iid ?? '?'} created in ${owner}/${repo}`,
    });
  }

  const client = await forgejoConnectionService.getClient();
  if (!client) return err('forgejo_not_configured');
  const { data } = await issueCreateIssue({
    client,
    path: { owner, repo },
    body: { title, body, labels: parseForgejoLabelIds(action.labels) },
    throwOnError: true,
  });
  return ok({
    message: data?.html_url
      ? `Issue created at ${data.html_url}`
      : `Issue #${data?.number ?? '?'} created in ${owner}/${repo}`,
  });
}

function parseForgejoLabelIds(labels: string[] | undefined): number[] | undefined {
  if (!labels || labels.length === 0) return undefined;
  const ids = labels.map((label) => Number.parseInt(label, 10)).filter((n) => Number.isFinite(n));
  return ids.length > 0 ? ids : undefined;
}

async function createJiraIssue(
  action: IssueCreateAction,
  title: string,
  body: string
): Promise<Result<ActionOutcome, string>> {
  const projectKey = action.target?.trim();
  if (!projectKey) return err('jira_target_project_key_required');

  const { siteUrl, email, token } = await jiraConnectionService.requireAuth();
  const created = (await jiraPostJson(siteUrl, email, token, '/rest/api/3/issue', {
    fields: {
      project: { key: projectKey },
      summary: title,
      description: plainTextToAdf(body),
      issuetype: { name: 'Task' },
      ...(action.labels && action.labels.length > 0 ? { labels: action.labels } : {}),
    },
  })) as { key?: string };

  if (!created?.key) return err('jira_create_no_key_returned');
  const base = siteUrl.replace(/\/$/, '');
  return ok({ message: `Issue created at ${base}/browse/${created.key}` });
}

async function createLinearIssue(
  action: IssueCreateAction,
  title: string,
  body: string
): Promise<Result<ActionOutcome, string>> {
  const target = action.target?.trim();
  if (!target) return err('linear_target_team_required');

  const client = await linearConnectionService.getClient();
  if (!client) return err('linear_not_configured');

  const teamId = await resolveLinearTeamId(client, target);
  if (!teamId) return err(`linear_team_not_found:${target}`);

  const payload = await client.createIssue({
    teamId,
    title,
    description: body,
  });
  if (!payload.success) return err('linear_create_failed');
  const issue = await payload.issue;
  return ok({
    message: issue?.url
      ? `Issue created at ${issue.url}`
      : `Issue ${issue?.identifier ?? ''} created`,
  });
}

async function resolveLinearTeamId(
  client: NonNullable<Awaited<ReturnType<typeof linearConnectionService.getClient>>>,
  target: string
): Promise<string | null> {
  // Linear team UUIDs are lowercase hex with dashes; team keys are short alphanumerics.
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(target)) {
    return target;
  }
  const teams = await client.teams({ filter: { key: { eq: target } } });
  const node = teams.nodes[0];
  return node?.id ?? null;
}
