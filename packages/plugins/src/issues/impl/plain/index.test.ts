import type { Logger } from '@emdash/shared/logger';
import type * as PlainSdk from '@team-plain/graphql';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectedIntegrationHostContext } from '../../../integrations/host';
import { provider } from './index';

const plainSdk = vi.hoisted(() => ({
  threads: vi.fn(),
  searchThreads: vi.fn(),
  thread: vi.fn(),
  threadByRef: vi.fn(),
}));

vi.mock('@team-plain/graphql', async (importOriginal) => {
  const actual = await importOriginal<typeof PlainSdk>();
  return {
    ...actual,
    PlainClient: class {
      query = plainSdk;
    },
  };
});

const issues = provider.behavior.issues;
if (!issues) {
  throw new Error('Plain issues behavior is not registered.');
}

function makeHost(): ConnectedIntegrationHostContext {
  const log: Logger = {
    level: 'info',
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    child: () => log,
  };
  return { log, credentials: { apiKey: 'plain_api_key' } };
}

function plainThread(overrides: Record<string, unknown> = {}) {
  return {
    id: 'th_01ABC',
    ref: 'SUP-42',
    title: 'Billing page crashes',
    description: 'The billing page crashes when opening invoices.',
    previewText: 'Billing page crashes when opening invoices.',
    priority: 1,
    status: 'TODO',
    updatedAt: { iso8601: '2026-05-01T10:00:00.000Z' },
    customer: Promise.resolve(undefined),
    ...overrides,
  };
}

describe('plain issues plugin', () => {
  beforeEach(() => {
    plainSdk.threads.mockReset();
    plainSdk.searchThreads.mockReset();
    plainSdk.thread.mockReset();
    plainSdk.threadByRef.mockReset();
  });

  it('lists open threads sorted by recency and maps them to issues', async () => {
    plainSdk.threads.mockResolvedValueOnce({ nodes: [plainThread()] });

    const result = await issues.listIssues(makeHost(), { limit: 10 });

    expect(plainSdk.threads).toHaveBeenCalledWith({
      filters: { statuses: ['TODO', 'SNOOZED', 'DONE'] },
      sortBy: { field: 'CREATED_AT', direction: 'DESC' },
      first: 10,
    });
    expect(result).toEqual({
      success: true,
      data: [
        {
          identifier: 'SUP-42',
          title: 'Billing page crashes',
          description: 'Billing page crashes when opening invoices.',
          status: 'TODO',
          branchName: 'SUP-42-Billing page crashes',
          updatedAt: '2026-05-01T10:00:00.000Z',
        },
      ],
    });
  });

  it('falls back to the thread id when a thread has no ref', async () => {
    plainSdk.threads.mockResolvedValueOnce({
      nodes: [plainThread({ ref: null, title: null })],
    });

    const result = await issues.listIssues(makeHost(), { limit: 10 });

    expect(result).toEqual({
      success: true,
      data: [
        expect.objectContaining({
          identifier: 'th_01ABC',
          title: 'th_01ABC',
          branchName: undefined,
        }),
      ],
    });
  });

  it('searches threads and maps the raw search fragments', async () => {
    plainSdk.searchThreads.mockResolvedValueOnce({
      edges: [{ node: { thread: plainThread() } }],
    });

    const result = await issues.searchIssues(makeHost(), { searchTerm: 'billing', limit: 5 });

    expect(plainSdk.searchThreads).toHaveBeenCalledWith({
      searchQuery: { term: 'billing' },
      first: 5,
    });
    expect(result).toEqual({
      success: true,
      data: [expect.objectContaining({ identifier: 'SUP-42' })],
    });
  });

  it('returns no results for search terms shorter than two characters', async () => {
    const result = await issues.searchIssues(makeHost(), { searchTerm: ' a ', limit: 5 });

    expect(result).toEqual({ success: true, data: [] });
    expect(plainSdk.searchThreads).not.toHaveBeenCalled();
  });

  it('fetches an issue by ref and includes customer and description context', async () => {
    plainSdk.threadByRef.mockResolvedValueOnce(
      plainThread({
        description: 'Full description with reproduction steps.',
        customer: Promise.resolve({
          fullName: 'Grace Hopper',
          identities: [{ __typename: 'EmailCustomerIdentity', email: 'grace@example.com' }],
        }),
      })
    );

    const result = await issues.getIssue?.(makeHost(), { identifier: 'SUP-42' });

    expect(plainSdk.threadByRef).toHaveBeenCalledWith({ ref: 'SUP-42' });
    expect(plainSdk.thread).not.toHaveBeenCalled();
    expect(result?.success).toBe(true);
    const context = result?.success ? result.data.context : '';
    expect(context).toContain('Priority: High');
    expect(context).toContain('Customer: Grace Hopper <grace@example.com>');
    expect(context).toContain('Full description with reproduction steps.');
  });

  it('fetches an issue by thread id when the identifier is not a ref', async () => {
    plainSdk.thread.mockResolvedValueOnce(plainThread());

    const result = await issues.getIssue?.(makeHost(), { identifier: 'th_01ABC' });

    expect(plainSdk.thread).toHaveBeenCalledWith({ threadId: 'th_01ABC' });
    expect(plainSdk.threadByRef).not.toHaveBeenCalled();
    expect(result?.success).toBe(true);
  });

  it('keeps the issue context when the customer lookup fails', async () => {
    plainSdk.threadByRef.mockResolvedValueOnce(
      plainThread({
        description: 'Description that must survive.',
        get customer() {
          return Promise.reject(new Error('customer unavailable'));
        },
      })
    );

    const result = await issues.getIssue?.(makeHost(), { identifier: 'SUP-42' });

    expect(result?.success).toBe(true);
    const context = result?.success ? result.data.context : '';
    expect(context).toContain('Description that must survive.');
    expect(context).not.toContain('Customer:');
  });

  it('returns not found when the thread lookup resolves no thread', async () => {
    plainSdk.threadByRef.mockRejectedValueOnce(new Error('threadByRef not found'));

    const result = await issues.getIssue?.(makeHost(), { identifier: 'SUP-42' });

    expect(result).toEqual({
      success: false,
      error: { type: 'not_found_or_no_access', message: 'Plain thread not found: SUP-42' },
    });
  });

  it('returns a generic error when the thread lookup fails otherwise', async () => {
    plainSdk.threads.mockRejectedValueOnce(new Error('boom'));

    const result = await issues.listIssues(makeHost(), { limit: 10 });

    expect(result).toEqual({
      success: false,
      error: { type: 'generic', message: 'boom' },
    });
  });
});
