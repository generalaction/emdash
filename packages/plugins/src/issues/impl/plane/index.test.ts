import { noopLogger } from '@emdash/shared/logger';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as planeClient from '../../../integrations/impl/plane/client';
import {
  getPlaneAuth,
  PlaneHttpError,
  type PlaneClient,
} from '../../../integrations/impl/plane/client';
import { provider } from './index';

vi.mock('../../../integrations/impl/plane/client', async (importOriginal) => {
  const actual = await importOriginal<typeof planeClient>();
  return { ...actual, getPlaneAuth: vi.fn() };
});

const issues = provider.behavior.issues;
if (!issues) throw new Error('Plane issues plugin has no issues behavior');

const mockGetPlaneAuth = vi.mocked(getPlaneAuth);
const host = { log: noopLogger, credentials: {} };

function mockAuth(client: Partial<Record<keyof PlaneClient, unknown>>) {
  mockGetPlaneAuth.mockReturnValue({
    apiBaseUrl: 'https://api.plane.so',
    workspaceSlug: 'my-team',
    apiKey: 'plane-key',
    client: client as unknown as PlaneClient,
  });
}

describe('plane issues plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists Plane work items across accessible projects', async () => {
    const client = {
      listProjects: vi.fn().mockResolvedValue([
        { id: 'project-1', identifier: 'ENG', name: 'Engineering' },
        { id: 'project-2', identifier: 'OPS', name: 'Operations' },
      ]),
      listWorkItems: vi
        .fn()
        .mockResolvedValueOnce([
          {
            id: 'item-1',
            name: 'Fix login',
            description_stripped: 'Users cannot log in.',
            sequence_id: 12,
            updated_at: '2026-05-01T10:00:00Z',
            state: { name: 'Todo' },
            assignees: [{ display_name: 'Ada' }],
          },
        ])
        .mockResolvedValueOnce([]),
    };
    mockAuth(client);

    const result = await issues.listIssues(host, { limit: 10 });

    expect(client.listProjects).toHaveBeenCalledWith('my-team', 10);
    expect(client.listWorkItems).toHaveBeenNthCalledWith(1, 'my-team', 'project-1', 10);
    expect(result).toEqual({
      success: true,
      data: [
        expect.objectContaining({
          identifier: 'ENG-12',
          title: 'Fix login',
          url: 'https://app.plane.so/my-team/browse/ENG-12',
          description: 'Users cannot log in.',
          status: 'Todo',
          assignees: ['Ada'],
          project: 'Engineering',
          updatedAt: '2026-05-01T10:00:00Z',
        }),
      ],
    });
  });

  it('searches Plane work items with a non-trivial term', async () => {
    const client = {
      searchWorkItems: vi.fn().mockResolvedValue([
        {
          id: 'item-2',
          name: 'Add dark mode',
          sequence_id: 7,
          project: { id: 'project-1', identifier: 'ENG', name: 'Engineering' },
        },
      ]),
    };
    mockAuth(client);

    const result = await issues.searchIssues(host, { searchTerm: ' dark mode ', limit: 5 });

    expect(client.searchWorkItems).toHaveBeenCalledWith('my-team', 'dark mode', 5);
    expect(result).toEqual({
      success: true,
      data: [expect.objectContaining({ identifier: 'ENG-7', title: 'Add dark mode' })],
    });
  });

  it('does not search Plane for a one-character term', async () => {
    const client = { searchWorkItems: vi.fn() };
    mockAuth(client);

    const result = await issues.searchIssues(host, { searchTerm: 'a', limit: 5 });

    expect(client.searchWorkItems).not.toHaveBeenCalled();
    expect(result).toEqual({ success: true, data: [] });
  });

  it('fetches Plane issue context by identifier', async () => {
    const client = {
      getWorkItemByIdentifier: vi.fn().mockResolvedValue({
        id: 'item-3',
        name: 'Triage alert',
        sequence_id: 99,
        description_stripped: 'Investigate alert details.',
        priority: 'high',
        project: { id: 'project-1', identifier: 'OPS', name: 'Operations' },
      }),
    };
    mockAuth(client);

    const result = await issues.getIssue?.(host, { identifier: 'OPS-99' });

    expect(client.getWorkItemByIdentifier).toHaveBeenCalledWith('my-team', 'OPS-99');
    expect(result).toEqual({
      success: true,
      data: expect.objectContaining({
        identifier: 'OPS-99',
        title: 'Triage alert',
        context: expect.stringContaining('Priority: high'),
      }),
    });
  });

  it('maps Plane HTTP failures to a typed issue error', async () => {
    const client = {
      listProjects: vi
        .fn()
        .mockRejectedValue(new PlaneHttpError(401, 'Unauthorized', 'Invalid API key')),
    };
    mockAuth(client);

    const result = await issues.listIssues(host, { limit: 10 });

    expect(result).toEqual({
      success: false,
      error: {
        type: 'generic',
        message: 'Plane authentication failed. Check your API key and permissions.',
      },
    });
  });
});
