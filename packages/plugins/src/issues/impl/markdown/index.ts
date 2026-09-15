import { err, ok, type Result } from '@emdash/shared';
import type { ConnectedIntegrationHostContext } from '../../../integrations/host';
import { readMarkdownTasksConfig } from '../../../integrations/impl/markdown/config';
import type { IIssuesBehavior } from '../../capabilities/issues';
import { clampIssueLimit, normalizeSearchTerm } from '../../helpers/provider-inputs';
import { sortByUpdatedAtDesc } from '../../helpers/sort-by-updated-at-desc';
import { defineIssuesPlugin, registerIssuesPluginBehavior } from '../../plugin';
import type {
  IssueData,
  IssueError,
  IssueGetOpts,
  IssueGetResult,
  IssueListResult,
  IssueQueryOpts,
  IssueSearchOpts,
} from '../../types';
import { toIssueData, type BriefFile } from './brief';
import { readBriefs, type BriefReaderDependencies } from './repository';

const LIST_LIMIT = 50;
const SEARCH_LIMIT = 20;
const MAX_LIMIT = 200;

/**
 * Tasks read out of markdown files in the repository the project points at.
 * Strictly read-only: the provider never writes to a task file, so the
 * repository's own tooling stays the only thing that changes a task's state.
 */
export function createMarkdownIssuesBehavior(
  resolveReader: () => BriefReaderDependencies | undefined
): Required<Pick<IIssuesBehavior, 'listIssues' | 'searchIssues' | 'getIssue'>> {
  async function load(
    host: ConnectedIntegrationHostContext,
    repositoryPath: string | undefined
  ): Promise<Result<IssueData[], IssueError>> {
    const dependencies = resolveReader();
    if (!dependencies) {
      return err({
        type: 'generic',
        message: 'Repository task files can only be read from the desktop process.',
      });
    }

    const config = readMarkdownTasksConfig(host.credentials);
    if (!config.success) return err(config.error);

    const path = repositoryPath?.trim();
    if (!path) {
      return err({
        type: 'invalid_input',
        message: 'Open a local repository to list its task files.',
      });
    }

    const read = await readBriefs(dependencies, {
      repositoryPath: path,
      pattern: config.data.taskPattern,
      trunkRef: config.data.trunkRef,
    });
    if (!read.success) {
      host.log.warn('Repository tasks read failed', { error: read.error });
      return err(read.error);
    }
    if (read.data.source === 'working-tree' && config.data.trunkRef) {
      host.log.warn('Configured ref did not resolve; reading the working tree instead', {
        trunkRef: config.data.trunkRef,
      });
    }

    return ok(
      sortByUpdatedAtDesc(
        read.data.files.map((file: BriefFile) => toIssueData(file, config.data.taskPattern))
      )
    );
  }

  return {
    async listIssues(
      host: ConnectedIntegrationHostContext,
      opts: IssueQueryOpts
    ): Promise<IssueListResult> {
      const loaded = await load(host, opts.repositoryPath);
      if (!loaded.success) return err(loaded.error);
      return ok(loaded.data.slice(0, clampIssueLimit(opts.limit, LIST_LIMIT, MAX_LIMIT)));
    },

    async searchIssues(
      host: ConnectedIntegrationHostContext,
      opts: IssueSearchOpts
    ): Promise<IssueListResult> {
      const term = normalizeSearchTerm(opts.searchTerm);
      if (!term) return ok([]);

      const loaded = await load(host, opts.repositoryPath);
      if (!loaded.success) return err(loaded.error);

      const needle = term.toLowerCase();
      const matched = loaded.data.filter((issue) => matches(issue, needle));
      return ok(matched.slice(0, clampIssueLimit(opts.limit, SEARCH_LIMIT, MAX_LIMIT)));
    },

    async getIssue(
      host: ConnectedIntegrationHostContext,
      opts: IssueGetOpts
    ): Promise<IssueGetResult> {
      const identifier = opts.identifier.trim();
      const loaded = await load(host, opts.repositoryPath);
      if (!loaded.success) return err(loaded.error);

      const issue = loaded.data.find(
        (candidate) => candidate.identifier.toLowerCase() === identifier.toLowerCase()
      );
      if (!issue) {
        return err({
          type: 'not_found_or_no_access',
          message: `No task file matches "${identifier}".`,
        });
      }
      // The file is the context: an agent prompted with the task should read
      // the same document a person would open.
      return ok({
        ...issue,
        ...(issue.description !== undefined && { context: issue.description }),
      });
    },
  };
}

function matches(issue: IssueData, needle: string): boolean {
  return (
    issue.identifier.toLowerCase().includes(needle) ||
    issue.title.toLowerCase().includes(needle) ||
    (issue.labels ?? []).some((label) => label.toLowerCase().includes(needle)) ||
    (issue.description ?? '').toLowerCase().includes(needle)
  );
}

const plugin = defineIssuesPlugin(
  { integrationId: 'markdown' },
  { issues: { requiredInputs: ['repositoryPath'] } },
  {}
);

/**
 * The filesystem and git bindings, installed once by the process that has
 * them. `@emdash/plugins/issues` itself stays free of node builtins because
 * the renderer program typechecks this module graph; `@emdash/plugins/issues/node`
 * is what supplies the real reader.
 */
let briefReader: BriefReaderDependencies | undefined;

export function setMarkdownBriefReader(reader: BriefReaderDependencies): void {
  briefReader = reader;
}

export const provider = registerIssuesPluginBehavior(plugin, {
  issues: createMarkdownIssuesBehavior(() => briefReader),
});
