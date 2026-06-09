import { clampIssueLimit, normalizeSearchTerm } from '@main/core/issues/helpers/provider-inputs';
import type { IssueProvider } from '@main/core/issues/issue-provider';
import { log } from '@main/lib/logger';
import type { LinkedIssue } from '@shared/core/linked-issue';
import {
  ISSUE_PROVIDER_CAPABILITIES,
  type IssueContextResult,
  type IssueListResult,
} from '@shared/issue-providers';
import { plainConnectionService, toPlainErrorMessage } from './plain-connection-service';

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

function toIssue(thread: PlainThreadLike): LinkedIssue {
  const ref = thread.ref ?? null;
  const title = thread.title ?? '';
  // Synthesize a branch-style name so `getIssueTaskName` can prefix the task
  // name with the thread ref (e.g. t-1070-fix-login). Plain's branchName is
  // never used as the actual git branch — resolveTaskBranchName only honors
  // Linear's branchName.
  const branchName = ref ? (title ? `${ref}-${title}` : ref) : undefined;
  return {
    provider: 'plain',
    identifier: ref ?? thread.id,
    title,
    url: '',
    description: thread.previewText ?? thread.description ?? undefined,
    status: thread.status ?? undefined,
    branchName,
    updatedAt: thread.updatedAt?.iso8601 ?? undefined,
    fetchedAt: new Date().toISOString(),
  };
}

async function listIssues(limit: number): Promise<IssueListResult> {
  const client = await plainConnectionService.getClient();
  if (!client) {
    return { success: false, error: 'Plain is not configured. Connect Plain in settings.' };
  }

  const first = clampIssueLimit(limit, 50, 100);

  try {
    const connection = await client.query.threads({
      filters: { statuses: ['TODO', 'SNOOZED', 'DONE'] },
      sortBy: { field: 'CREATED_AT', direction: 'DESC' },
      first,
    });

    return {
      success: true,
      issues: connection.nodes.map((thread) => toIssue(thread as PlainThreadLike)),
    };
  } catch (error) {
    return {
      success: false,
      error: toPlainErrorMessage(error, 'Failed to fetch Plain threads.'),
    };
  }
}

async function searchIssues(searchTerm: string, limit: number): Promise<IssueListResult> {
  const term = normalizeSearchTerm(searchTerm);
  if (!term || term.length < 2) {
    return { success: true, issues: [] };
  }

  const client = await plainConnectionService.getClient();
  if (!client) {
    return { success: false, error: 'Plain is not configured. Connect Plain in settings.' };
  }

  const first = clampIssueLimit(limit, 20, 100);

  try {
    const result = await client.query.searchThreads({
      searchQuery: { term },
      first,
    });

    if (!result?.edges) {
      return { success: true, issues: [] };
    }

    return {
      success: true,
      issues: result.edges.map((edge) => toIssue(edge.node.thread as PlainThreadLike)),
    };
  } catch (error) {
    log.error('[Plain] searchThreads error:', error);
    return { success: true, issues: [] };
  }
}

function formatPlainContext(
  thread: PlainThreadLike,
  customer: { fullName?: string | null; email?: string | null } | null
): string {
  // Title/Status/Description (preview) are emitted by `buildIssueContextText`
  // from the top-level `Issue` fields. This block adds the Plain-specific
  // metadata that doesn't fit the generic Issue shape, plus the full thread
  // description when it carries more than the preview.
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

async function fetchThreadByIdentifier(
  client: NonNullable<Awaited<ReturnType<typeof plainConnectionService.getClient>>>,
  identifier: string
) {
  if (THREAD_REF_PATTERN.test(identifier)) {
    return client.query.threadByRef({ ref: identifier });
  }
  return client.query.thread({ threadId: identifier });
}

async function getIssueContext(identifier: string): Promise<IssueContextResult> {
  const term = normalizeSearchTerm(identifier);
  if (!term) {
    return { success: false, error: 'Plain thread identifier is required.' };
  }

  const client = await plainConnectionService.getClient();
  if (!client) {
    return { success: false, error: 'Plain is not configured. Connect Plain in settings.' };
  }

  try {
    const thread = await fetchThreadByIdentifier(client, term);
    // ThreadModel exposes most scalars on the instance, but labels are not
    // promoted to the model — read the raw response data for completeness.
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
      log.warn('[Plain] failed to hydrate customer for thread context:', error);
    }

    const enriched: LinkedIssue = {
      ...toIssue(threadData),
      context: formatPlainContext(threadData, customerSummary),
    };

    return { success: true, issue: enriched };
  } catch (error) {
    log.error('[Plain] getIssueContext error:', error);
    return {
      success: false,
      error: toPlainErrorMessage(error, 'Failed to fetch Plain thread context.'),
    };
  }
}

export const plainIssueProvider: IssueProvider = {
  type: 'plain',
  capabilities: ISSUE_PROVIDER_CAPABILITIES.plain,

  isConfigured: () => plainConnectionService.isConfigured(),

  checkConnection: () => plainConnectionService.checkConnection(),

  listIssues: async (opts) => listIssues(opts.limit ?? 50),

  searchIssues: async (opts) => searchIssues(opts.searchTerm, opts.limit ?? 20),

  getIssueContext: async (opts) => getIssueContext(opts.identifier),
};
