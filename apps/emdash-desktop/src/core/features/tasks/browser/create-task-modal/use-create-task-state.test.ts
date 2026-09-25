import { deferred } from '@emdash/shared/testing';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IssueContextResult } from '@core/primitives/issue-providers/api';
import type { LinkedIssue } from '@core/primitives/linked-issues/api';
import { useCreateTaskState, type CreateTaskState } from './use-create-task-state';

const settings = vi.hoisted(() => ({ preserveNameCapitalization: false }));
const getIssueContext = vi.hoisted(() => vi.fn());
vi.mock('@core/features/issues/api/browser/client', () => ({
  getIssuesClient: async () => ({ getIssueContext }),
}));
vi.mock('@core/features/tasks/api/browser/hooks/useTaskSettings', () => ({
  useTaskSettings: () => ({
    ...settings,
    autoGenerateName: false,
    createBranchAndWorktree: true,
  }),
}));
vi.mock('@core/features/settings/api/browser/use-app-settings-key', () => ({
  useAppSettingsKey: () => ({ value: { branchPrefix: '', appendRandomBranchSuffix: false } }),
}));
vi.mock('@core/features/source-control/api/browser/stores/source-control-selectors', () => ({
  getGitRepositoryStore: () => undefined,
}));
vi.mock('@core/features/tasks/api/browser/create-task-modal/use-workspace-config', async () => {
  const { useBranchName } = await import('./use-branch-name');
  return {
    useWorkspaceConfig: (opts: Parameters<typeof useBranchName>[0]) => ({
      isValid: true,
      branchNameState: useBranchName(opts),
    }),
  };
});
vi.mock('@core/features/tasks/api/browser/client', () => ({
  getTasksWireClient: vi.fn(),
}));

let state: CreateTaskState | undefined;
function Probe() {
  state = useCreateTaskState(
    'project-1',
    { type: 'local', branch: 'main' },
    false,
    true,
    'main',
    'workspace-1',
    undefined,
    'issue'
  );
  return null;
}
function currentState() {
  if (!state) throw new Error('Create task form has not rendered');
  return state;
}

describe('issue-derived task names', () => {
  let dom: JSDOM;
  let root: Root;
  let queryClient: QueryClient;

  beforeEach(() => {
    state = undefined;
    settings.preserveNameCapitalization = false;
    getIssueContext.mockReset();
    getIssueContext.mockResolvedValue({
      success: false,
      error: { type: 'generic', message: 'Offline' },
    });
    dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
    vi.stubGlobal('window', dom.window);
    vi.stubGlobal('document', dom.window.document);
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const container = dom.window.document.getElementById('root');
    if (!container) throw new Error('Missing test root');
    root = createRoot(container);
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
      queryClient.clear();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    vi.unstubAllGlobals();
    dom.window.close();
  });

  it('loads full issue context using the selected account before allowing creation', async () => {
    const listed: LinkedIssue = {
      provider: 'clickup',
      identifier: 'HGAI-2316',
      title: 'Fix Login',
      url: 'https://app.clickup.com/t/86abc123',
      accountId: 'clickup:421:72',
      branchName: 'HGAI-2316-Fix Login',
    };
    const full = {
      ...listed,
      context: '## Acceptance\n- Keep the return URL\n\n### Subtasks\n- Write test',
    };
    const pending = deferred<IssueContextResult>();
    getIssueContext.mockReturnValueOnce(pending.promise);
    await act(async () => {
      root.render(
        createElement(QueryClientProvider, { client: queryClient }, createElement(Probe))
      );
    });
    await act(async () => currentState().setLinkedIssue(listed));
    expect(currentState().isValid).toBe(false);
    act(() => currentState().workspaceConfig.branchNameState.setBranchName('feature/my-branch'));
    expect(getIssueContext).toHaveBeenCalledWith({
      provider: 'clickup',
      options: {
        identifier: 'HGAI-2316',
        projectId: 'project-1',
        accountId: 'clickup:421:72',
        issueUrl: listed.url,
      },
    });
    await act(async () => {
      pending.resolve({ success: true, data: full });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(currentState().linkedIssue).toEqual(full);
      expect(currentState().isValid).toBe(true);
      expect(currentState().workspaceConfig.branchNameState.branchName).toBe('feature/my-branch');
    });
  });

  it.each([
    { preserve: true, expected: 'HGAI-2316-Fix-Login' },
    { preserve: false, expected: 'hgai-2316-fix-login' },
  ])(
    'respects preserveNameCapitalization=$preserve for ClickUp tickets',
    async ({ preserve, expected }) => {
      settings.preserveNameCapitalization = preserve;
      await act(async () => {
        root.render(
          createElement(QueryClientProvider, { client: queryClient }, createElement(Probe))
        );
      });
      await act(async () => {
        currentState().setLinkedIssue({
          provider: 'clickup',
          identifier: 'HGAI-2316',
          title: 'Fix Login',
          url: 'https://app.clickup.com/t/86abc123',
          branchName: 'HGAI-2316-Fix Login',
        });
      });
      expect(currentState().taskName.effectiveTaskName).toBe(expected);
    }
  );
});
