# Monday.com Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Monday.com as an issue provider integration so users can link board items to emdash tasks.

**Architecture:** 3-layer pattern (connection service → issue provider → RPC controller) matching the existing Linear integration. Raw `fetch` calls to Monday's GraphQL API — no SDK dependency. Credentials (token + board IDs) stored as encrypted JSON blob.

**Tech Stack:** TypeScript, Monday.com GraphQL API (v2), Vitest for testing, React for setup form.

---

## File Structure

### New Files

| File | Responsibility |
|------|----------------|
| `src/main/core/monday/monday-connection-service.ts` | Token + board URL storage, API validation, credential caching |
| `src/main/core/monday/monday-issue-provider.ts` | IssueProvider implementation, GraphQL queries, item→Issue transform |
| `src/main/core/monday/controller.ts` | RPC endpoints: saveCredentials, clearCredentials, checkConnection |
| `src/main/core/monday/monday-issue-provider.test.ts` | Unit tests for issue provider |
| `src/main/core/monday/monday-connection-service.test.ts` | Unit tests for connection service |
| `src/renderer/features/integrations/MondaySetupForm.tsx` | Setup form with token + board URLs fields |

### Modified Files

| File | Change |
|------|--------|
| `src/shared/tasks.ts` | Add `'monday'` to `Issue['provider']` union |
| `src/shared/issue-providers.ts` | Add `monday` to `ISSUE_PROVIDER_CAPABILITIES` |
| `src/main/core/issues/registry.ts` | Import + register `mondayIssueProvider` |
| `src/main/rpc.ts` | Import + register `mondayController` |
| `src/renderer/features/integrations/issue-provider-meta.ts` | Add Monday to order + meta |
| `src/renderer/features/integrations/integrations-provider.tsx` | Add Monday config, context fields, hook |
| `src/renderer/features/integrations/integration-setup-modal.tsx` | Add Monday state, submit case, form render |

---

## Task 1: Add Monday to Shared Types

**Files:**
- Modify: `src/shared/tasks.ts:8`
- Modify: `src/shared/issue-providers.ts:10-43`

- [ ] **Step 1: Add 'monday' to Issue provider union**

In `src/shared/tasks.ts`, change line 8:

```typescript
// Before:
provider: 'github' | 'linear' | 'jira' | 'gitlab' | 'plain' | 'forgejo' | 'featurebase' | 'asana';

// After:
provider: 'github' | 'linear' | 'jira' | 'gitlab' | 'plain' | 'forgejo' | 'featurebase' | 'asana' | 'monday';
```

- [ ] **Step 2: Add Monday capabilities**

In `src/shared/issue-providers.ts`, add after the `asana` entry (before the closing `}`):

```typescript
  monday: {
    requiresProjectPath: false,
    requiresRepositoryUrl: false,
  },
```

- [ ] **Step 3: Run typecheck to confirm no downstream errors**

Run: `pnpm run typecheck`
Expected: Errors in `registry.ts` (missing monday provider registration) and possibly renderer files — this is expected and will be fixed in later tasks.

- [ ] **Step 4: Commit**

```bash
git add src/shared/tasks.ts src/shared/issue-providers.ts
git commit -m "feat(monday): add monday to shared issue provider types"
```

---

## Task 2: Monday Connection Service

**Files:**
- Create: `src/main/core/monday/monday-connection-service.ts`
- Test: `src/main/core/monday/monday-connection-service.test.ts`

- [ ] **Step 1: Write failing tests for the connection service**

Create `src/main/core/monday/monday-connection-service.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockSetSecret = vi.fn();
const mockGetSecret = vi.fn();
const mockDeleteSecret = vi.fn();

vi.mock('@main/core/secrets/encrypted-app-secrets-store', () => ({
  encryptedAppSecretsStore: {
    setSecret: (...args: unknown[]) => mockSetSecret(...args),
    getSecret: (...args: unknown[]) => mockGetSecret(...args),
    deleteSecret: (...args: unknown[]) => mockDeleteSecret(...args),
  },
}));

vi.mock('@main/lib/logger', () => ({
  log: { error: vi.fn() },
}));

vi.mock('@main/lib/telemetry', () => ({
  telemetryService: { capture: vi.fn() },
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { MondayConnectionService } from './monday-connection-service';

describe('MondayConnectionService', () => {
  let service: MondayConnectionService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new MondayConnectionService();
  });

  describe('saveCredentials', () => {
    it('validates token against Monday API and stores credentials', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { me: { id: '123', name: 'Snir', account: { name: 'My Team' } } } }),
      });

      const result = await service.saveCredentials({ token: 'valid-token', boardUrls: '' });

      expect(result).toEqual({ success: true, workspaceName: 'My Team' });
      expect(mockSetSecret).toHaveBeenCalledWith(
        'emdash-monday-credentials',
        JSON.stringify({ token: 'valid-token', boardIds: [] })
      );
    });

    it('parses board IDs from URLs', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { me: { id: '123', name: 'Snir', account: { name: 'My Team' } } } }),
      });

      const result = await service.saveCredentials({
        token: 'valid-token',
        boardUrls: 'https://myteam.monday.com/boards/123456, https://myteam.monday.com/boards/789012',
      });

      expect(result.success).toBe(true);
      expect(mockSetSecret).toHaveBeenCalledWith(
        'emdash-monday-credentials',
        JSON.stringify({ token: 'valid-token', boardIds: ['123456', '789012'] })
      );
    });

    it('returns error for invalid board URL format', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { me: { id: '123', name: 'Snir', account: { name: 'My Team' } } } }),
      });

      const result = await service.saveCredentials({
        token: 'valid-token',
        boardUrls: 'not-a-url',
      });

      expect(result).toEqual({
        success: false,
        error: expect.stringContaining('Could not parse board ID'),
      });
    });

    it('returns error for empty token', async () => {
      const result = await service.saveCredentials({ token: '  ', boardUrls: '' });

      expect(result).toEqual({ success: false, error: 'Monday.com API token cannot be empty.' });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('returns error when API validation fails', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ errors: [{ message: 'Not Authenticated' }] }),
      });

      const result = await service.saveCredentials({ token: 'bad-token', boardUrls: '' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Not Authenticated');
    });
  });

  describe('checkConnection', () => {
    it('returns connected with workspace name when token is valid', async () => {
      mockGetSecret.mockResolvedValueOnce(
        JSON.stringify({ token: 'stored-token', boardIds: [] })
      );
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { me: { id: '123', name: 'Snir', account: { name: 'My Team' } } } }),
      });

      const result = await service.checkConnection();

      expect(result.connected).toBe(true);
      expect(result.displayName).toBe('My Team');
    });

    it('returns not connected when no stored credentials', async () => {
      mockGetSecret.mockResolvedValueOnce(null);

      const result = await service.checkConnection();

      expect(result.connected).toBe(false);
    });
  });

  describe('clearCredentials', () => {
    it('deletes stored credentials', async () => {
      const result = await service.clearCredentials();

      expect(result).toEqual({ success: true });
      expect(mockDeleteSecret).toHaveBeenCalledWith('emdash-monday-credentials');
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/main/core/monday/monday-connection-service.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the connection service**

Create `src/main/core/monday/monday-connection-service.ts`:

```typescript
import { encryptedAppSecretsStore } from '@main/core/secrets/encrypted-app-secrets-store';
import { log } from '@main/lib/logger';
import { telemetryService } from '@main/lib/telemetry';
import { ISSUE_PROVIDER_CAPABILITIES, type ConnectionStatus } from '@shared/issue-providers';

const MONDAY_API_URL = 'https://api.monday.com/v2';
const CREDENTIALS_KEY = 'emdash-monday-credentials';

type MondayCredentials = {
  token: string;
  boardIds: string[];
};

type SaveCredentialsInput = {
  token: string;
  boardUrls: string;
};

export class MondayConnectionService {
  private cachedCredentials: MondayCredentials | null | undefined = undefined;

  async saveCredentials(
    input: SaveCredentialsInput
  ): Promise<{ success: boolean; workspaceName?: string; error?: string }> {
    const token = input.token.trim();
    if (!token) {
      return { success: false, error: 'Monday.com API token cannot be empty.' };
    }

    const boardIds = this.parseBoardUrls(input.boardUrls);
    if (boardIds === null) {
      return {
        success: false,
        error: `Could not parse board ID from one or more URLs. Expected format: https://<team>.monday.com/boards/<id>`,
      };
    }

    try {
      const me = await this.fetchMe(token);
      const credentials: MondayCredentials = { token, boardIds };
      await this.storeCredentials(credentials);
      telemetryService.capture('integration_connected', { provider: 'monday' });
      return { success: true, workspaceName: me.accountName ?? me.name };
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Failed to validate Monday.com token. Please try again.';
      return { success: false, error: message };
    }
  }

  async clearCredentials(): Promise<{ success: boolean; error?: string }> {
    try {
      await encryptedAppSecretsStore.deleteSecret(CREDENTIALS_KEY);
      this.cachedCredentials = null;
      telemetryService.capture('integration_disconnected', { provider: 'monday' });
      return { success: true };
    } catch (error) {
      log.error('Failed to clear Monday.com credentials:', error);
      return { success: false, error: 'Unable to remove Monday.com credentials from secure storage.' };
    }
  }

  async checkConnection(): Promise<ConnectionStatus> {
    try {
      const credentials = await this.getStoredCredentials();
      if (!credentials) {
        return { connected: false, capabilities: ISSUE_PROVIDER_CAPABILITIES.monday };
      }

      const me = await this.fetchMe(credentials.token);
      return {
        connected: true,
        displayName: me.accountName ?? me.name,
        capabilities: ISSUE_PROVIDER_CAPABILITIES.monday,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to verify Monday.com connection.';
      return { connected: false, error: message, capabilities: ISSUE_PROVIDER_CAPABILITIES.monday };
    }
  }

  async getStoredCredentials(): Promise<MondayCredentials | null> {
    if (this.cachedCredentials !== undefined) {
      return this.cachedCredentials;
    }

    try {
      const raw = await encryptedAppSecretsStore.getSecret(CREDENTIALS_KEY);
      if (!raw) {
        this.cachedCredentials = null;
        return null;
      }
      this.cachedCredentials = JSON.parse(raw) as MondayCredentials;
      return this.cachedCredentials;
    } catch (error) {
      log.error('Failed to read Monday.com credentials from secure storage:', error);
      return null;
    }
  }

  async query<T>(token: string, queryStr: string, variables?: Record<string, unknown>): Promise<T> {
    const response = await fetch(MONDAY_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: token,
      },
      body: JSON.stringify({ query: queryStr, variables }),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      const message =
        body?.errors?.[0]?.message ?? body?.error_message ?? `Monday API error (${response.status})`;
      throw new Error(message);
    }

    const json = await response.json();
    if (json.errors?.length) {
      throw new Error(json.errors[0].message);
    }
    return json.data as T;
  }

  private parseBoardUrls(boardUrls: string): string[] | null {
    const raw = boardUrls.trim();
    if (!raw) return [];

    const urls = raw.split(/[,\n]+/).map((s) => s.trim()).filter(Boolean);
    const ids: string[] = [];

    for (const url of urls) {
      const match = url.match(/monday\.com\/boards\/(\d+)/);
      if (!match) return null;
      ids.push(match[1]);
    }

    return ids;
  }

  private async fetchMe(token: string): Promise<{ id: string; name: string; accountName?: string }> {
    const data = await this.query<{ me: { id: string; name: string; account: { name: string } } }>(
      token,
      'query { me { id name account { name } } }'
    );
    return { id: data.me.id, name: data.me.name, accountName: data.me.account?.name };
  }

  private async storeCredentials(credentials: MondayCredentials): Promise<void> {
    try {
      await encryptedAppSecretsStore.setSecret(CREDENTIALS_KEY, JSON.stringify(credentials));
      this.cachedCredentials = credentials;
    } catch (error) {
      log.error('Failed to store Monday.com credentials:', error);
      throw new Error('Unable to store Monday.com credentials securely.');
    }
  }
}

export const mondayConnectionService = new MondayConnectionService();
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/main/core/monday/monday-connection-service.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/core/monday/monday-connection-service.ts src/main/core/monday/monday-connection-service.test.ts
git commit -m "feat(monday): add connection service with token validation and board URL parsing"
```

---

## Task 3: Monday Issue Provider

**Files:**
- Create: `src/main/core/monday/monday-issue-provider.ts`
- Test: `src/main/core/monday/monday-issue-provider.test.ts`

- [ ] **Step 1: Write failing tests for the issue provider**

Create `src/main/core/monday/monday-issue-provider.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { mondayConnectionService } from './monday-connection-service';
import { mondayIssueProvider } from './monday-issue-provider';

vi.mock('./monday-connection-service', () => ({
  mondayConnectionService: {
    getStoredCredentials: vi.fn(),
    checkConnection: vi.fn(),
    query: vi.fn(),
  },
}));

const mockGetStoredCredentials = vi.mocked(mondayConnectionService.getStoredCredentials);
const mockQuery = vi.mocked(mondayConnectionService.query);

describe('mondayIssueProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('listIssues', () => {
    it('returns items from configured boards', async () => {
      mockGetStoredCredentials.mockResolvedValue({ token: 'tok', boardIds: ['111'] });
      mockQuery.mockResolvedValue({
        boards: [
          {
            id: '111',
            name: 'Sprint Board',
            board_url: 'https://myteam.monday.com/boards/111',
            items_page: {
              items: [
                {
                  id: '101',
                  name: 'Fix login bug',
                  updated_at: '2026-05-20T10:00:00Z',
                  group: { title: 'In Progress' },
                  column_values: [
                    { id: 'status', type: 'status', text: 'Working on it' },
                    { id: 'person', type: 'people', text: 'Snir' },
                  ],
                },
              ],
            },
          },
        ],
      });

      const result = await mondayIssueProvider.listIssues({ limit: 50 });

      expect(result).toEqual({
        success: true,
        issues: [
          expect.objectContaining({
            provider: 'monday',
            identifier: '101',
            title: 'Fix login bug',
            status: 'Working on it',
            assignees: ['Snir'],
            project: 'Sprint Board',
            url: 'https://myteam.monday.com/boards/111/pulses/101',
          }),
        ],
      });
    });

    it('returns error when no credentials stored', async () => {
      mockGetStoredCredentials.mockResolvedValue(null);

      const result = await mondayIssueProvider.listIssues({ limit: 50 });

      expect(result).toEqual({ success: false, error: 'Monday.com is not connected.' });
    });

    it('returns error when API query fails', async () => {
      mockGetStoredCredentials.mockResolvedValue({ token: 'tok', boardIds: ['111'] });
      mockQuery.mockRejectedValue(new Error('Rate limit exceeded'));

      const result = await mondayIssueProvider.listIssues({ limit: 50 });

      expect(result).toEqual({ success: false, error: 'Rate limit exceeded' });
    });
  });

  describe('searchIssues', () => {
    it('filters items by search term', async () => {
      mockGetStoredCredentials.mockResolvedValue({ token: 'tok', boardIds: ['111'] });
      mockQuery.mockResolvedValue({
        boards: [
          {
            id: '111',
            name: 'Sprint Board',
            board_url: 'https://myteam.monday.com/boards/111',
            items_page: {
              items: [
                {
                  id: '202',
                  name: 'Search feature',
                  updated_at: '2026-05-21T10:00:00Z',
                  group: { title: 'Done' },
                  column_values: [
                    { id: 'status', type: 'status', text: 'Done' },
                  ],
                },
              ],
            },
          },
        ],
      });

      const result = await mondayIssueProvider.searchIssues({ searchTerm: 'search', limit: 20 });

      expect(result).toEqual({
        success: true,
        issues: [
          expect.objectContaining({
            provider: 'monday',
            identifier: '202',
            title: 'Search feature',
          }),
        ],
      });
    });
  });

  describe('getIssueContext', () => {
    it('returns item with updates as context', async () => {
      mockGetStoredCredentials.mockResolvedValue({ token: 'tok', boardIds: ['111'] });
      mockQuery.mockResolvedValue({
        items: [
          {
            id: '101',
            name: 'Fix login bug',
            updated_at: '2026-05-20T10:00:00Z',
            board: { id: '111', name: 'Sprint Board', board_url: 'https://myteam.monday.com/boards/111' },
            group: { title: 'In Progress' },
            column_values: [
              { id: 'status', type: 'status', text: 'Working on it' },
            ],
            updates: [
              {
                id: 'upd-1',
                text_body: 'Started investigating the auth flow.',
                created_at: '2026-05-19T09:00:00Z',
                creator: { name: 'Snir' },
              },
            ],
          },
        ],
      });

      const result = await mondayIssueProvider.getIssueContext!({ identifier: '101' });

      expect(result).toEqual({
        success: true,
        issue: expect.objectContaining({
          provider: 'monday',
          identifier: '101',
          title: 'Fix login bug',
          context: expect.stringContaining('Started investigating the auth flow.'),
        }),
      });
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/main/core/monday/monday-issue-provider.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the issue provider**

Create `src/main/core/monday/monday-issue-provider.ts`:

```typescript
import { ISSUE_PROVIDER_CAPABILITIES } from '@shared/issue-providers';
import type { Issue } from '@shared/tasks';
import type {
  IssueContextOpts,
  IssueProvider,
  IssueQueryOpts,
  IssueSearchOpts,
} from '@main/core/issues/issue-provider';
import type { IssueContextResult, IssueListResult } from '@shared/issue-providers';
import { mondayConnectionService } from './monday-connection-service';

type MondayColumnValue = {
  id: string;
  type: string;
  text: string;
};

type MondayItem = {
  id: string;
  name: string;
  updated_at: string;
  group?: { title: string };
  column_values: MondayColumnValue[];
};

type MondayBoard = {
  id: string;
  name: string;
  board_url: string;
  items_page: { items: MondayItem[] };
};

type MondayItemWithContext = MondayItem & {
  board: { id: string; name: string; board_url: string };
  updates: { id: string; text_body: string; created_at: string; creator: { name: string } }[];
};

const ITEMS_FIELDS = `
  id
  name
  updated_at
  group { title }
  column_values { id type text }
`;

function buildBoardUrl(boardUrl: string, itemId: string): string {
  return `${boardUrl}/pulses/${itemId}`;
}

function toIssue(item: MondayItem, board: { name: string; board_url: string }, context?: string): Issue {
  const status = item.column_values.find((c) => c.type === 'status')?.text || undefined;
  const assigneesRaw = item.column_values.find((c) => c.type === 'people')?.text;
  const assignees = assigneesRaw ? assigneesRaw.split(',').map((s) => s.trim()).filter(Boolean) : undefined;

  return {
    provider: 'monday',
    identifier: item.id,
    title: item.name,
    url: buildBoardUrl(board.board_url, item.id),
    status,
    assignees,
    project: board.name,
    updatedAt: item.updated_at,
    fetchedAt: new Date().toISOString(),
    context,
  };
}

function formatContext(updates: MondayItemWithContext['updates']): string | undefined {
  if (!updates.length) return undefined;

  return updates
    .map((u) => `**${u.creator.name}** (${u.created_at}):\n${u.text_body}`)
    .join('\n\n');
}

async function listIssues(limit: number): Promise<IssueListResult> {
  const credentials = await mondayConnectionService.getStoredCredentials();
  if (!credentials) {
    return { success: false, error: 'Monday.com is not connected.' };
  }

  try {
    const query = credentials.boardIds.length
      ? `query ($boardIds: [ID!]!, $limit: Int!) {
          boards(ids: $boardIds) { id name board_url items_page(limit: $limit) { items { ${ITEMS_FIELDS} } } }
        }`
      : `query ($limit: Int!) {
          boards(limit: 20) { id name board_url items_page(limit: $limit) { items { ${ITEMS_FIELDS} } } }
        }`;

    const variables = credentials.boardIds.length
      ? { boardIds: credentials.boardIds, limit }
      : { limit };

    const data = await mondayConnectionService.query<{ boards: MondayBoard[] }>(
      credentials.token,
      query,
      variables
    );

    const issues: Issue[] = data.boards.flatMap((board) =>
      board.items_page.items.map((item) => toIssue(item, board))
    );

    return { success: true, issues: issues.slice(0, limit) };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to fetch Monday.com items.' };
  }
}

async function searchIssues(searchTerm: string, limit: number): Promise<IssueListResult> {
  const credentials = await mondayConnectionService.getStoredCredentials();
  if (!credentials) {
    return { success: false, error: 'Monday.com is not connected.' };
  }

  try {
    const query = credentials.boardIds.length
      ? `query ($boardIds: [ID!]!, $term: String!, $limit: Int!) {
          boards(ids: $boardIds) {
            id name board_url
            items_page(limit: $limit, query_params: { rules: [{ column_id: "name", compare_value: [$term], operator: contains_text }] }) {
              items { ${ITEMS_FIELDS} }
            }
          }
        }`
      : `query ($term: String!, $limit: Int!) {
          boards(limit: 20) {
            id name board_url
            items_page(limit: $limit, query_params: { rules: [{ column_id: "name", compare_value: [$term], operator: contains_text }] }) {
              items { ${ITEMS_FIELDS} }
            }
          }
        }`;

    const variables = credentials.boardIds.length
      ? { boardIds: credentials.boardIds, term: searchTerm, limit }
      : { term: searchTerm, limit };

    const data = await mondayConnectionService.query<{ boards: MondayBoard[] }>(
      credentials.token,
      query,
      variables
    );

    const issues: Issue[] = data.boards.flatMap((board) =>
      board.items_page.items.map((item) => toIssue(item, board))
    );

    return { success: true, issues: issues.slice(0, limit) };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to search Monday.com items.' };
  }
}

async function getIssueContext(opts: IssueContextOpts): Promise<IssueContextResult> {
  const credentials = await mondayConnectionService.getStoredCredentials();
  if (!credentials) {
    return { success: false, error: 'Monday.com is not connected.' };
  }

  try {
    const query = `query ($itemId: [ID!]!) {
      items(ids: $itemId) {
        id name updated_at
        board { id name board_url }
        group { title }
        column_values { id type text }
        updates { id text_body created_at creator { name } }
      }
    }`;

    const data = await mondayConnectionService.query<{ items: MondayItemWithContext[] }>(
      credentials.token,
      query,
      { itemId: [opts.identifier] }
    );

    const item = data.items[0];
    if (!item) {
      return { success: false, error: `Item ${opts.identifier} not found.` };
    }

    const context = formatContext(item.updates);
    const issue = toIssue(item, item.board, context);
    return { success: true, issue };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to fetch Monday.com item context.' };
  }
}

export const mondayIssueProvider: IssueProvider = {
  type: 'monday',
  capabilities: ISSUE_PROVIDER_CAPABILITIES.monday,
  checkConnection: () => mondayConnectionService.checkConnection(),
  listIssues: async (opts: IssueQueryOpts) => listIssues(opts.limit ?? 50),
  searchIssues: async (opts: IssueSearchOpts) => searchIssues(opts.searchTerm, opts.limit ?? 20),
  getIssueContext,
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/main/core/monday/monday-issue-provider.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/core/monday/monday-issue-provider.ts src/main/core/monday/monday-issue-provider.test.ts
git commit -m "feat(monday): add issue provider with list, search, and context support"
```

---

## Task 4: Monday RPC Controller

**Files:**
- Create: `src/main/core/monday/controller.ts`

- [ ] **Step 1: Create the controller**

Create `src/main/core/monday/controller.ts`:

```typescript
import { createRPCController } from '@shared/ipc/rpc';
import { mondayConnectionService } from './monday-connection-service';

export const mondayController = createRPCController({
  saveCredentials: async (input: { token: string; boardUrls: string }) => {
    if (!input?.token || typeof input.token !== 'string') {
      return { success: false, error: 'A Monday.com API token is required.' };
    }
    return mondayConnectionService.saveCredentials(input);
  },

  checkConnection: async () => mondayConnectionService.checkConnection(),

  clearCredentials: async () => mondayConnectionService.clearCredentials(),
});
```

- [ ] **Step 2: Register controller in rpc.ts**

In `src/main/rpc.ts`, add import (alphabetical, after line 16 `linearController`):

```typescript
import { mondayController } from './core/monday/controller';
```

Add to router object (alphabetical, after `linear: linearController,`):

```typescript
  monday: mondayController,
```

- [ ] **Step 3: Register provider in registry**

In `src/main/core/issues/registry.ts`, add import:

```typescript
import { mondayIssueProvider } from '@main/core/monday/monday-issue-provider';
```

Add registration call after `register(asanaIssueProvider);`:

```typescript
register(mondayIssueProvider);
```

- [ ] **Step 4: Run typecheck**

Run: `pnpm run typecheck`
Expected: Errors only in renderer files (missing Monday UI pieces) — main process should be clean.

- [ ] **Step 5: Commit**

```bash
git add src/main/core/monday/controller.ts src/main/rpc.ts src/main/core/issues/registry.ts
git commit -m "feat(monday): add RPC controller and register provider"
```

---

## Task 5: Monday Setup Form (Renderer)

**Files:**
- Create: `src/renderer/features/integrations/MondaySetupForm.tsx`
- Modify: `src/renderer/features/integrations/integration-setup-modal.tsx`
- Modify: `src/renderer/features/integrations/integrations-provider.tsx`
- Modify: `src/renderer/features/integrations/issue-provider-meta.ts`

- [ ] **Step 1: Create the MondaySetupForm component**

Create `src/renderer/features/integrations/MondaySetupForm.tsx`:

```typescript
import React from 'react';
import { Input } from '@renderer/lib/ui/input';

interface Props {
  token: string;
  boardUrls: string;
  onChange: (update: Partial<{ token: string; boardUrls: string }>) => void;
  error?: string | null;
}

const MondaySetupForm: React.FC<Props> = ({ token, boardUrls, onChange, error }) => {
  return (
    <div className="grid gap-2">
      <Input
        type="password"
        placeholder="API token"
        value={token}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange({ token: e.target.value })}
        className="h-9 w-full"
        autoFocus
      />
      <Input
        placeholder="Board URLs (optional, comma-separated)"
        value={boardUrls}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
          onChange({ boardUrls: e.target.value })
        }
        className="h-9 w-full"
      />
      <p className="text-muted-foreground text-xs">
        Generate a token at{' '}
        <span className="font-medium">monday.com {'>'} Admin {'>'} API</span>. Optionally paste board
        URLs to scope which items appear.
      </p>
      {error ? (
        <p className="text-destructive text-xs" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
};

export default MondaySetupForm;
```

- [ ] **Step 2: Add Monday to issue-provider-meta.ts**

In `src/renderer/features/integrations/issue-provider-meta.ts`:

Add `'monday'` to `ISSUE_PROVIDER_ORDER` array (after `'asana'`):

```typescript
export const ISSUE_PROVIDER_ORDER: IssueProviderType[] = [
  'linear', 'github', 'jira', 'gitlab', 'asana', 'monday', 'forgejo', 'featurebase', 'plain',
];
```

Add to `ISSUE_PROVIDER_META`:

```typescript
  monday: { displayName: 'Monday.com' },
```

- [ ] **Step 3: Add Monday to integrations-provider.tsx**

In `src/renderer/features/integrations/integrations-provider.tsx`:

Add validation function after `validateInstanceCredentials`:

```typescript
function validateMondayCredentials(input: { token: string; boardUrls: string }): string | null {
  if (!input.token?.trim()) {
    return 'API token is required.';
  }
  return null;
}
```

Add to `PROVIDER_CONNECTION_CONFIG` (before `} as const;`):

```typescript
  monday: {
    connectMutationFn: (credentials: { token: string; boardUrls: string }) =>
      rpc.monday.saveCredentials(credentials),
    disconnectMutationFn: () => rpc.monday.clearCredentials(),
    fallbackError: DEFAULT_CONNECT_ERROR,
    validateInput: validateMondayCredentials,
  },
```

Add to `IntegrationsContextValue` type:

```typescript
  isMondayConnected: boolean | null;
  isMondayLoading: boolean;
  connectMonday: (credentials: { token: string; boardUrls: string }) => Promise<void>;
  disconnectMonday: () => Promise<void>;
```

Add hook setup inside `IntegrationsProvider` (after `asanaConnection`):

```typescript
  const mondayConnection = useProviderConnection({
    ...PROVIDER_CONNECTION_CONFIG.monday,
    invalidate: invalidateStatuses,
  });
```

Add to provider value (in `IntegrationsContext.Provider value={{}}`):

```typescript
        isMondayConnected: isConnected(statusData, 'monday'),
        isMondayLoading: isInitialConnectionCheck || mondayConnection.isLoading,
        connectMonday: mondayConnection.connect,
        disconnectMonday: mondayConnection.disconnect,
```

- [ ] **Step 4: Add Monday to integration-setup-modal.tsx**

In `src/renderer/features/integrations/integration-setup-modal.tsx`:

Add import:

```typescript
import MondaySetupForm from './MondaySetupForm';
```

Add `'monday'` to `IntegrationType`:

```typescript
type IntegrationType = 'linear' | 'jira' | 'gitlab' | 'plain' | 'forgejo' | 'featurebase' | 'asana' | 'monday';
```

Add to `descriptions`:

```typescript
  monday: {
    title: 'Connect Monday.com',
    subtitle: 'Enter your Monday.com API token and optionally specify board URLs.',
  },
```

Add to destructured context:

```typescript
    connectMonday,
    isMondayLoading,
```

Add state variables:

```typescript
  // Monday state
  const [mondayToken, setMondayToken] = useState('');
  const [mondayBoardUrls, setMondayBoardUrls] = useState('');
```

Add to `isLoading`:

```typescript
    (integration === 'monday' && isMondayLoading);
```

Add to `canSubmit`:

```typescript
    (integration === 'monday' && !!mondayToken.trim());
```

Add to `handleSubmit` switch:

```typescript
        case 'monday':
          await connectMonday({ token: mondayToken.trim(), boardUrls: mondayBoardUrls.trim() });
          break;
```

Add to dependency array of `handleSubmit`:

```typescript
    mondayToken,
    mondayBoardUrls,
    connectMonday,
```

Add form render (after asana form):

```typescript
        {integration === 'monday' && (
          <MondaySetupForm
            token={mondayToken}
            boardUrls={mondayBoardUrls}
            onChange={(u) => {
              if (typeof u.token === 'string') setMondayToken(u.token);
              if (typeof u.boardUrls === 'string') setMondayBoardUrls(u.boardUrls);
            }}
            error={error}
          />
        )}
```

- [ ] **Step 5: Run typecheck and lint**

Run: `pnpm run typecheck && pnpm run lint`
Expected: PASS (no errors)

- [ ] **Step 6: Commit**

```bash
git add src/renderer/features/integrations/MondaySetupForm.tsx \
  src/renderer/features/integrations/issue-provider-meta.ts \
  src/renderer/features/integrations/integrations-provider.tsx \
  src/renderer/features/integrations/integration-setup-modal.tsx
git commit -m "feat(monday): add renderer setup form and provider registration"
```

---

## Task 6: Full Validation

**Files:** None (validation only)

- [ ] **Step 1: Run format**

Run: `pnpm run format`
Expected: PASS or auto-fixes formatting

- [ ] **Step 2: Run lint**

Run: `pnpm run lint`
Expected: PASS

- [ ] **Step 3: Run typecheck**

Run: `pnpm run typecheck`
Expected: PASS — no type errors

- [ ] **Step 4: Run all tests**

Run: `pnpm run test`
Expected: All tests pass, including the new Monday tests

- [ ] **Step 5: Commit any format fixes**

If formatting changed files:

```bash
git add -u
git commit -m "style: format monday integration files"
```
