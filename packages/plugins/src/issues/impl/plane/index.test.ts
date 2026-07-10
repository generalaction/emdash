import { noopLogger } from '@emdash/shared/logger';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConnectedIntegrationHostContext } from '../../../integrations/host';
import { provider } from './index';

const planeSdk = vi.hoisted(() => ({
  projectsList: vi.fn(),
  workItemsList: vi.fn(),
  workItemsRetrieveByIdentifier: vi.fn(),
  workItemsSearch: vi.fn(),
}));

vi.mock('@makeplane/plane-node-sdk', () => ({
  PlaneClient: class {
    projects = { list: planeSdk.projectsList };
    workItems = {
      list: planeSdk.workItemsList,
      retrieveByIdentifier: planeSdk.workItemsRetrieveByIdentifier,
      search: planeSdk.workItemsSearch,
    };
  },
}));

const issues = provider.behavior.issues;
if (!issues?.getIssue) throw new Error('Plane issues plugin has no issues behavior');
const getIssue = issues.getIssue;

const CREDENTIALS = {
  apiBaseUrl: 'https://api.plane.so',
  workspaceSlug: 'my-team',
  apiKey: 'plane-key',
};

const host: ConnectedIntegrationHostContext = { log: noopLogger, credentials: CREDENTIALS };

const PROJECT = { id: 'project-1', identifier: 'ENG', name: 'Engineering' };
// Unexpanded list items reference state/assignees/project as bare UUIDs.
const WORK_ITEM = {
  id: 'item-1',
  name: 'Fix login',
  description_stripped: 'Users cannot log in.',
  sequence_id: 12,
  updated_at: '2026-05-01T10:00:00Z',
  state: '11111111-2222-3333-4444-555555555555',
  assignees: ['66666666-7777-8888-9999-000000000000'],
  project: 'project-1',
};

describe('plane issues plugin', () => {
  afterEach(() => {
    planeSdk.projectsList.mockReset();
    planeSdk.workItemsList.mockReset();
    planeSdk.workItemsRetrieveByIdentifier.mockReset();
    planeSdk.workItemsSearch.mockReset();
  });

  it('lists Plane work items across accessible projects', async () => {
    planeSdk.projectsList.mockResolvedValue({
      results: [PROJECT, { id: 'project-2', identifier: 'OPS', name: 'Operations' }],
    });
    planeSdk.workItemsList.mockResolvedValueOnce({ results: [WORK_ITEM] });
    planeSdk.workItemsList.mockResolvedValueOnce({ results: [] });

    const result = await issues.listIssues(host, { limit: 10 });

    expect(result).toEqual({
      success: true,
      data: [
        {
          identifier: 'ENG-12',
          title: 'Fix login',
          url: 'https://app.plane.so/my-team/browse/ENG-12',
          description: 'Users cannot log in.',
          project: 'Engineering',
          updatedAt: '2026-05-01T10:00:00Z',
        },
      ],
    });

    expect(planeSdk.projectsList).toHaveBeenCalledWith('my-team', { limit: 10 });
    expect(planeSdk.workItemsList).toHaveBeenNthCalledWith(1, 'my-team', 'project-1', {
      limit: 10,
    });
    expect(planeSdk.workItemsList).toHaveBeenNthCalledWith(2, 'my-team', 'project-2', {
      limit: 9,
    });
  });

  it('searches Plane work items with a non-trivial term', async () => {
    planeSdk.workItemsSearch.mockResolvedValue({
      issues: [
        {
          id: 'item-2',
          name: 'Add dark mode',
          sequence_id: '7',
          project__identifier: 'ENG',
          project_id: 'project-1',
          workspace__slug: 'my-team',
        },
      ],
    });

    const result = await issues.searchIssues(host, { searchTerm: ' dark mode ', limit: 5 });

    expect(result).toEqual({
      success: true,
      data: [
        expect.objectContaining({
          identifier: 'ENG-7',
          title: 'Add dark mode',
          url: 'https://app.plane.so/my-team/browse/ENG-7',
          project: 'ENG',
        }),
      ],
    });

    expect(planeSdk.workItemsSearch).toHaveBeenCalledWith('my-team', 'dark mode', undefined, {
      limit: 5,
    });
  });

  it('does not search Plane for a one-character term', async () => {
    const result = await issues.searchIssues(host, { searchTerm: 'a', limit: 5 });

    expect(planeSdk.workItemsSearch).not.toHaveBeenCalled();
    expect(result).toEqual({ success: true, data: [] });
  });

  it('fetches Plane issue context by identifier', async () => {
    planeSdk.workItemsRetrieveByIdentifier.mockResolvedValue({
      id: 'item-3',
      name: 'Triage alert',
      sequence_id: 99,
      description_stripped: 'Investigate alert details.',
      priority: 'high',
      project: { id: 'project-1', identifier: 'OPS', name: 'Operations' },
      state: { id: 'state-1', name: 'Todo' },
      assignees: [{ display_name: 'Ada' }],
    });

    const result = await getIssue(host, { identifier: 'OPS-99' });

    expect(result).toEqual({
      success: true,
      data: expect.objectContaining({
        identifier: 'OPS-99',
        title: 'Triage alert',
        status: 'Todo',
        assignees: ['Ada'],
        context: expect.stringContaining('Priority: high'),
      }),
    });
    expect(planeSdk.workItemsRetrieveByIdentifier).toHaveBeenCalledWith('my-team', 'OPS-99', [
      'assignees',
      'state',
      'project',
    ]);
  });

  it('maps Plane HTTP failures to a typed issue error', async () => {
    planeSdk.projectsList.mockRejectedValue(httpError('Invalid API key', 401));

    const result = await issues.listIssues(host, { limit: 10 });

    expect(result).toEqual({
      success: false,
      error: {
        type: 'auth_failed',
        message: 'Plane authentication failed. Check your credentials.',
      },
    });
  });
});

function httpError(message: string, statusCode: number): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode });
}
