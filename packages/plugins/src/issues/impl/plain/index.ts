import { err, ok } from '@emdash/shared';
import { getPlainClient, toPlainErrorMessage } from '../../../integrations/impl/plain/client';
import { clampIssueLimit, issueError, normalizeSearchTerm } from '../../helpers/provider-inputs';
import { defineIssuesPlugin, registerIssuesPluginBehavior } from '../../plugin';
import type { IssueData, IssueDetail } from '../../types';

type PlainThreadLike = {
  id: string;
  ref?: string | null;
  title?: string | null;
  previewText?: string | null;
  description?: string | null;
  status?: string | null;
  priority?: number | null;
  updatedAt?: { iso8601: string } | null;
  labels?: Array<{ labelType?: { name?: string | null } | null }> | null;
};

const THREAD_REF_PATTERN = /^[A-Za-z]+-\d+$/;
const PRIORITY_LABELS = ['Urgent', 'High', 'Normal', 'Low'] as const;

function priorityLabel(priority: number | null | undefined): string | undefined {
  if (priority == null) return undefined;
  return PRIORITY_LABELS[priority] ?? `P${priority}`;
}

function toIssue(thread: PlainThreadLike): IssueData {
  const ref = thread.ref ?? null;
  const title = thread.title ?? '';
  const branchName = ref ? (title ? `${ref}-${title}` : ref) : undefined;
  return {
    identifier: ref ?? thread.id,
    title,
    url: '',
    description: thread.previewText ?? thread.description ?? undefined,
    status: thread.status ?? undefined,
    branchName,
    updatedAt: thread.updatedAt?.iso8601 ?? undefined,
  };
}

function formatPlainContext(
  thread: PlainThreadLike,
  customer: { fullName?: string | null; email?: string | null } | null
): string {
  const lines: string[] = [];
  const priority = priorityLabel(thread.priority);
  if (priority) lines.push(`Priority: ${priority}`);

  if (customer?.fullName || customer?.email) {
    if (customer.fullName && customer.email) {
      lines.push(`Customer: ${customer.fullName} <${customer.email}>`);
    } else {
      lines.push(`Customer: ${customer.fullName ?? customer.email}`);
    }
  }

  const labelNames = (thread.labels ?? [])
    .map((l) => l.labelType?.name)
    .filter((n): n is string => !!n);
  if (labelNames.length > 0) lines.push(`Labels: ${labelNames.join(', ')}`);

  const description = thread.description?.trim();
  const preview = thread.previewText?.trim();
  if (description && description !== preview) {
    lines.push('');
    lines.push(description);
  }

  return lines.join('\n');
}

const plugin = defineIssuesPlugin({ integrationId: 'plain' }, { issues: {} }, {});

export const provider = registerIssuesPluginBehavior(plugin, {
  issues: {
    async listIssues(host, opts) {
      const client = getPlainClient(host.credentials);
      const first = clampIssueLimit(opts.limit, 50, 100);

      try {
        const connection = await client.query.threads({
          filters: { statuses: ['TODO', 'SNOOZED', 'DONE'] },
          sortBy: { field: 'CREATED_AT', direction: 'DESC' },
          first,
        });

        return ok(connection.nodes.map((thread) => toIssue(thread as PlainThreadLike)));
      } catch (error) {
        return err(
          issueError('generic', toPlainErrorMessage(error, 'Failed to fetch Plain threads.'))
        );
      }
    },

    async searchIssues(host, opts) {
      const term = normalizeSearchTerm(opts.searchTerm);
      if (!term || term.length < 2) return ok([]);

      const client = getPlainClient(host.credentials);
      const first = clampIssueLimit(opts.limit, 20, 100);

      try {
        const result = await client.query.searchThreads({ searchQuery: { term }, first });
        if (!result?.edges) return ok([]);
        return ok(result.edges.map((edge) => toIssue(edge.node.thread as PlainThreadLike)));
      } catch (error) {
        host.log.error('[Plain] searchThreads error', { error });
        return ok([]);
      }
    },

    async getIssue(host, opts) {
      const term = normalizeSearchTerm(opts.identifier);
      if (!term) return err(issueError('invalid_input', 'Plain thread identifier is required.'));

      const client = getPlainClient(host.credentials);

      try {
        const thread = THREAD_REF_PATTERN.test(term)
          ? await client.query.threadByRef({ ref: term })
          : await client.query.thread({ threadId: term });
        const rawData =
          (thread as unknown as { _data?: PlainThreadLike })._data ??
          (thread as unknown as PlainThreadLike);
        const threadData: PlainThreadLike = {
          ...rawData,
          id: thread.id,
          ref: thread.ref,
          title: thread.title,
          previewText: thread.previewText,
          description: thread.description,
          status: thread.status,
          priority: thread.priority,
          updatedAt: thread.updatedAt as PlainThreadLike['updatedAt'],
        };

        let customerSummary: { fullName?: string | null; email?: string | null } | null = null;
        try {
          const customer = await thread.customer;
          if (customer) {
            const emailIdentity = customer.identities?.find(
              (identity) => identity.__typename === 'EmailCustomerIdentity'
            ) as { email?: string } | undefined;
            customerSummary = { fullName: customer.fullName, email: emailIdentity?.email ?? null };
          }
        } catch (error) {
          host.log.warn('[Plain] failed to hydrate customer for thread context', { error });
        }

        return ok({
          ...toIssue(threadData),
          context: formatPlainContext(threadData, customerSummary),
        } satisfies IssueDetail);
      } catch (error) {
        host.log.error('[Plain] getIssue error', { error });
        return err(
          issueError('generic', toPlainErrorMessage(error, 'Failed to fetch Plain thread context.'))
        );
      }
    },
  },
});
