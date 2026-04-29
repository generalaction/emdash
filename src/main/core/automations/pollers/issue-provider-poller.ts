import type { IssueProvider as AutomationIssueProvider } from '@shared/automations/events';
import { getIssueProvider } from '@main/core/issues/registry';
import { getProjectById } from '@main/core/projects/operations/getProjects';
import { diffIssuesAgainstCursor } from './issue-helpers';
import type { Poller, PollerCursor, PollerResult } from './types';

export function makeIssueProviderPoller(
  provider: AutomationIssueProvider,
  opts: { requiresLocalPath?: boolean } = {}
): Poller {
  return {
    async poll(projectId: string, cursor: PollerCursor | null): Promise<PollerResult> {
      return diffIssuesAgainstCursor(provider, projectId, cursor, async () => {
        const impl = getIssueProvider(provider);
        if (!impl) return { ok: true, issues: [] };

        let projectPath: string | undefined;
        if (opts.requiresLocalPath) {
          const project = await getProjectById(projectId);
          if (!project || project.type !== 'local') return { ok: true, issues: [] };
          projectPath = project.path;
        }

        const result = await impl.listIssues({ projectId, projectPath, limit: 50 });
        if (!result.success) return { ok: false, error: result.error };
        return { ok: true, issues: result.issues };
      });
    },
  };
}
