import { beforeEach, describe, expect, it, vi } from 'vitest';
import { planeConnectionService } from './plane-connection-service';
import { planeIssueProvider } from './plane-issue-provider';

vi.mock('./plane-connection-service', () => ({
  planeConnectionService: {
    getAuth: vi.fn(),
    checkConnection: vi.fn(),
  },
  toPlaneErrorMessage: (error: unknown, fallback: string) =>
    error instanceof Error ? error.message : fallback,
}));

const mockGetAuth = vi.mocked(planeConnectionService.getAuth);

describe('planeIssueProvider', () => {
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
    mockGetAuth.mockResolvedValue({
      apiBaseUrl: 'https://api.plane.so',
      workspaceSlug: 'my-team',
      client,
    } as never);

    const result = await planeIssueProvider.listIssues({ limit: 10 });

    expect(client.listProjects).toHaveBeenCalledWith('my-team', 10);
    expect(client.listWorkItems).toHaveBeenCalledWith('my-team', 'project-1', 10);
    expect(result).toEqual({
      success: true,
      issues: [
        expect.objectContaining({
          provider: 'plane',
          identifier: 'ENG-12',
          title: 'Fix login',
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
    mockGetAuth.mockResolvedValue({
      apiBaseUrl: 'https://api.plane.so',
      workspaceSlug: 'my-team',
      client,
    } as never);

    const result = await planeIssueProvider.searchIssues({
      searchTerm: ' dark mode ',
      limit: 5,
    });

    expect(client.searchWorkItems).toHaveBeenCalledWith('my-team', 'dark mode', 5);
    expect(result).toEqual({
      success: true,
      issues: [expect.objectContaining({ identifier: 'ENG-7', title: 'Add dark mode' })],
    });
  });

  it('does not search Plane for a one-character term', async () => {
    const client = { searchWorkItems: vi.fn() };
    mockGetAuth.mockResolvedValue({
      apiBaseUrl: 'https://api.plane.so',
      workspaceSlug: 'my-team',
      client,
    } as never);

    const result = await planeIssueProvider.searchIssues({
      searchTerm: 'a',
      limit: 5,
    });

    expect(client.searchWorkItems).not.toHaveBeenCalled();
    expect(result).toEqual({ success: true, issues: [] });
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
    mockGetAuth.mockResolvedValue({
      apiBaseUrl: 'https://api.plane.so',
      workspaceSlug: 'my-team',
      client,
    } as never);

    const result = await planeIssueProvider.getIssueContext?.({ identifier: 'OPS-99' });

    expect(client.getWorkItemByIdentifier).toHaveBeenCalledWith('my-team', 'OPS-99');
    expect(result).toEqual({
      success: true,
      issue: expect.objectContaining({
        provider: 'plane',
        identifier: 'OPS-99',
        context: expect.stringContaining('Priority: high'),
      }),
    });
  });

  it('returns a configuration error when Plane is not connected', async () => {
    mockGetAuth.mockResolvedValue(null);

    const result = await planeIssueProvider.listIssues({ limit: 10 });

    expect(result).toEqual({
      success: false,
      error: 'Plane is not configured. Connect Plane in settings.',
    });
  });
});
