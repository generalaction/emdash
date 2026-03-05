import { beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import { LinearService } from '../../main/services/LinearService';

type LinearIssueNode = {
  identifier: string;
  updatedAt?: string | null;
};

describe('LinearService sorting', () => {
  let service: LinearService;
  let serviceInternals: {
    getStoredToken: () => Promise<string | null>;
    graphql: (
      token: string,
      query: string,
      variables?: Record<string, unknown>
    ) => Promise<unknown>;
  };
  let getStoredTokenSpy: MockInstance;
  let graphqlSpy: MockInstance;

  beforeEach(() => {
    service = new LinearService();
    serviceInternals = service as unknown as typeof serviceInternals;
    getStoredTokenSpy = vi
      .spyOn(serviceInternals, 'getStoredToken')
      .mockResolvedValue('test-token');
    graphqlSpy = vi.spyOn(serviceInternals, 'graphql');
  });

  it('sorts initial issue fetch by updatedAt descending', async () => {
    const nodes: LinearIssueNode[] = [
      { identifier: 'GEN-101', updatedAt: '2026-02-28T10:00:00.000Z' },
      { identifier: 'GEN-103', updatedAt: '2026-03-01T15:30:00.000Z' },
      { identifier: 'GEN-102', updatedAt: '2026-03-01T09:00:00.000Z' },
    ];

    graphqlSpy.mockResolvedValue({ issues: { nodes } });

    const issues = await service.initialFetch(50);

    expect(issues.map((issue) => issue.identifier)).toEqual(['GEN-103', 'GEN-102', 'GEN-101']);
    expect(getStoredTokenSpy).toHaveBeenCalled();
  });

  it('sorts search results by updatedAt descending and pushes invalid timestamps to the end', async () => {
    const nodes: LinearIssueNode[] = [
      { identifier: 'GEN-200', updatedAt: null },
      { identifier: 'GEN-201', updatedAt: 'not-a-date' },
      { identifier: 'GEN-202', updatedAt: '2026-03-03T11:45:00.000Z' },
      { identifier: 'GEN-203', updatedAt: '2026-03-02T08:15:00.000Z' },
    ];

    graphqlSpy.mockResolvedValue({ searchIssues: { nodes } });

    const issues = await service.searchIssues('picker sort', 20);
    const identifiers = issues.map((issue) => issue.identifier);

    expect(identifiers.slice(0, 2)).toEqual(['GEN-202', 'GEN-203']);
    expect(new Set(identifiers.slice(2))).toEqual(new Set(['GEN-200', 'GEN-201']));
    expect(getStoredTokenSpy).toHaveBeenCalled();
  });
});
