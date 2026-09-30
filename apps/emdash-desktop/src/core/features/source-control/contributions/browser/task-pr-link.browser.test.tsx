import { observer } from 'mobx-react-lite';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { TaskPrAssociationStore } from '@core/features/source-control/api/browser/stores/task-pr-association-store';
// oxlint-disable-next-line emdash/core-module-boundaries -- exercise the real PR selection rule and canonical data used by the titlebar contribution
import { selectCurrentPr, type PullRequest } from '@core/services/pull-requests/api';
import { TaskPrLink } from './task-pr-link';

const mocks = vi.hoisted(() => ({ openExternal: vi.fn() }));

vi.mock('@core/primitives/desktop-host/browser/host-client', () => ({
  openExternal: mocks.openExternal,
}));

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

function pullRequest(overrides: Partial<PullRequest> = {}): PullRequest {
  return {
    url: 'https://github.com/generalaction/emdash/pull/42',
    provider: 'github',
    repositoryUrl: 'https://github.com/generalaction/emdash',
    baseRefName: 'main',
    baseRefOid: 'base',
    headRepositoryUrl: 'https://github.com/MattJColes/emdash',
    headRefName: 'feature',
    headRefOid: 'head',
    identifier: '#42',
    title: 'Surface task pull requests',
    description: null,
    status: 'open',
    isDraft: false,
    additions: null,
    deletions: null,
    changedFiles: null,
    commitCount: null,
    mergeableStatus: null,
    mergeStateStatus: null,
    reviewDecision: null,
    createdAt: '2026-09-30T00:00:00Z',
    updatedAt: '2026-09-30T00:00:00Z',
    author: null,
    labels: [],
    assignees: [],
    checks: [],
    ...overrides,
  };
}

describe('TaskPrLink', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mocks.openExternal.mockReset();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  async function render(pr: PullRequest | undefined) {
    await act(async () => root.render(<TaskPrLink pr={pr} />));
  }

  it('renders no link without an associated PR', async () => {
    await render(undefined);
    expect(host.querySelector('a')).toBeNull();
  });

  it('opens the returned PR URL in the external browser', async () => {
    const pr = pullRequest();
    await render(pr);
    const link = page.getByRole('link', {
      name: 'Open PR #42 in browser: Surface task pull requests (Open)',
    });
    await expect.element(link).toHaveAttribute('href', pr.url);
    await act(async () => link.click());
    expect(mocks.openExternal).toHaveBeenCalledExactlyOnceWith(pr.url);
  });

  it('supports keyboard activation', async () => {
    await render(pullRequest());
    await act(async () => userEvent.keyboard('{Tab}'));
    await expect.element(page.getByRole('link')).toHaveFocus();
    await act(async () => userEvent.keyboard('{Enter}'));
    expect(mocks.openExternal).toHaveBeenCalledExactlyOnceWith(pullRequest().url);
  });

  it.each([
    { status: 'open', isDraft: false, label: 'Open', icon: '.lucide-git-pull-request-arrow' },
    { status: 'open', isDraft: true, label: 'Draft', icon: '.lucide-git-pull-request-draft' },
    { status: 'merged', isDraft: false, label: 'Merged', icon: '.lucide-git-merge' },
    { status: 'closed', isDraft: true, label: 'Closed', icon: '.lucide-git-pull-request-closed' },
  ] as const)('shows the $label status in its icon and tooltip', async ({ label, icon, ...pr }) => {
    await render(pullRequest(pr));
    const link = page.getByRole('link', {
      name: `Open PR #42 in browser: Surface task pull requests (${label})`,
    });
    expect(host.querySelector(icon)).not.toBeNull();
    await act(async () => link.hover());
    await expect.element(page.getByText(`Surface task pull requests · ${label}`)).toBeVisible();
  });

  it('keeps the link usable without a PR identifier', async () => {
    const pr = pullRequest({ identifier: null });
    await render(pr);
    const link = page.getByRole('link', {
      name: 'Open Pull request in browser: Surface task pull requests (Open)',
    });
    await expect.element(link).toHaveTextContent('Pull request');
    await act(async () => link.click());
    expect(mocks.openExternal).toHaveBeenCalledExactlyOnceWith(pr.url);
  });

  it('appears when a PR is associated and follows subsequent status changes', async () => {
    const association = new TaskPrAssociationStore();
    const AssociatedLink = observer(() => (
      <TaskPrLink pr={selectCurrentPr(association.pullRequests)} />
    ));
    await act(async () => root.render(<AssociatedLink />));
    expect(host.querySelector('a')).toBeNull();

    const pr = pullRequest();
    await act(async () => association.setAssociation([pr], { kind: 'unknown' }));
    await expect.element(page.getByRole('link')).toHaveTextContent('PR #42');

    await act(async () => association.updateAssociatedPr({ ...pr, status: 'merged' }));
    await expect
      .element(page.getByRole('link'))
      .toHaveAccessibleName('Open PR #42 in browser: Surface task pull requests (Merged)');

    await act(async () => association.setAssociation([], { kind: 'unknown' }));
    expect(host.querySelector('a')).toBeNull();
  });
});
