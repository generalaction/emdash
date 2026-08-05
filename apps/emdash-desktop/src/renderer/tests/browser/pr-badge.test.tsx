import { type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { TaskRowInteractionSurface } from '@renderer/features/projects/components/task-view/task-row-interaction-surface';
import { PullRequestEntryHeader } from '@renderer/features/tasks/diff-view/changes-panel/components/pr-entry/pr-entry-header';
import { PrBadge } from '@renderer/lib/components/pr-badge';
import { type PullRequest } from '@shared/core/pull-requests/pull-requests';

const mocks = vi.hoisted(() => ({
  openExternal: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@renderer/lib/ipc', () => ({
  rpc: {
    app: {
      openExternal: mocks.openExternal,
    },
  },
}));

const pr: PullRequest = {
  url: 'https://github.com/generalaction/emdash/pull/2082',
  provider: 'github',
  repositoryUrl: 'https://github.com/generalaction/emdash',
  baseRefName: 'main',
  baseRefOid: 'base-sha',
  headRepositoryUrl: 'https://github.com/generalaction/emdash',
  headRefName: 'improve-pr-badge',
  headRefOid: 'head-sha',
  identifier: '#2082',
  title: 'Improve PR badge navigation',
  description: null,
  status: 'open',
  isDraft: false,
  additions: 1,
  deletions: 0,
  changedFiles: 1,
  commitCount: 1,
  mergeableStatus: 'MERGEABLE',
  mergeStateStatus: 'CLEAN',
  reviewDecision: null,
  createdAt: '2026-05-18T01:26:32Z',
  updatedAt: '2026-05-18T01:26:32Z',
  author: null,
  labels: [],
  assignees: [],
  checks: [],
};

const accessibleName = 'Open pull request #2082: Improve PR badge navigation';
const detailsAccessibleName = 'Show details for pull request #2082';

describe('PrBadge', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mocks.openExternal.mockClear();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    flushSync(() => root.unmount());
    container.remove();
  });

  it.each(['default', 'compact'] as const)(
    'exposes the %s badge as a labelled PR navigation button',
    async (variant) => {
      render(<PrBadge variant={variant} pr={pr} />);
      const trigger = page.getByRole('button', { name: accessibleName });

      await expect.element(trigger).toBeVisible();
      await expect.element(trigger).toHaveAttribute('type', 'button');
      await expect.element(trigger).toHaveClass(/cursor-pointer/);
      await expect.element(trigger).not.toHaveAttribute('aria-haspopup');
    }
  );

  it('keeps compact preview control narrower than the default badge segment', async () => {
    render(<PrBadge variant="compact" pr={pr} />);
    const details = page.getByRole('button', { name: detailsAccessibleName });

    await expect.element(details).toHaveClass(/h-5/);
    await expect.element(details).toHaveClass(/w-3/);
    await expect.element(details).not.toHaveClass(/size-5/);
  });

  it('gives each preview control a PR-specific accessible name with a title fallback', async () => {
    const fallbackPr = {
      ...pr,
      url: 'https://github.com/generalaction/emdash/pull/fallback',
      identifier: null,
      title: 'Fallback PR title',
    };
    render(
      <>
        <PrBadge pr={pr} />
        <PrBadge pr={fallbackPr} />
      </>
    );

    const numberedDetails = page.getByRole('button', { name: detailsAccessibleName });
    const fallbackDetails = page.getByRole('button', {
      name: 'Show details for pull request: Fallback PR title',
    });
    await expect.element(numberedDetails).toBeVisible();
    await expect.element(fallbackDetails).toBeVisible();
    expect(
      new Set(
        [...container.querySelectorAll('[aria-label^="Show details for pull request"]')].map(
          (element) => element.getAttribute('aria-label')
        )
      ).size
    ).toBe(2);
  });

  it('opens the pull request directly without bubbling the row click', async () => {
    const parentClick = vi.fn();
    render(
      <div onClick={parentClick}>
        <PrBadge pr={pr} />
      </div>
    );

    await userEvent.click(page.getByRole('button', { name: accessibleName }));

    expect(mocks.openExternal).toHaveBeenCalledOnce();
    expect(mocks.openExternal).toHaveBeenCalledWith(pr.url);
    expect(parentClick).not.toHaveBeenCalled();
  });

  it('cancels a delayed hover preview when direct navigation starts', async () => {
    render(<PrBadge pr={pr} hoverDelay={100} />);
    const navigation = page.getByRole('button', { name: accessibleName });

    await userEvent.hover(navigation);
    await userEvent.click(navigation);
    await new Promise((resolve) => window.setTimeout(resolve, 150));

    expect(mocks.openExternal).toHaveBeenCalledOnce();
    expect(document.querySelector('[aria-label="Copy PR URL"]')).toBeNull();
  });

  it.each([
    ['Enter', '{Enter}'],
    ['Space', ' '],
  ])('opens the pull request with the %s key', async (_keyName, key) => {
    render(<PrBadge variant="compact" pr={pr} />);
    const trigger = page.getByRole('button', { name: accessibleName });

    await userEvent.tab();
    await expect.element(trigger).toHaveFocus();
    await userEvent.keyboard(key);

    expect(mocks.openExternal).toHaveBeenCalledOnce();
    expect(mocks.openExternal).toHaveBeenCalledWith(pr.url);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('keeps the hover preview and copy action available', async () => {
    render(<PrBadge pr={pr} hoverDelay={0} />);

    await userEvent.hover(page.getByRole('button', { name: accessibleName }));

    await expect.element(page.getByRole('button', { name: 'Copy PR URL' })).toBeVisible();
  });

  it('exposes preview and copy as a separate keyboard action', async () => {
    render(<PrBadge pr={pr} />);
    const navigation = page.getByRole('button', { name: accessibleName });
    const details = page.getByRole('button', {
      name: detailsAccessibleName,
    });

    await userEvent.tab();
    await expect.element(navigation).toHaveFocus();
    expect(document.querySelector('[aria-label="Copy PR URL"]')).toBeNull();

    await userEvent.tab();
    await expect.element(details).toHaveFocus();
    await userEvent.keyboard('{Enter}');

    const copy = page.getByRole('button', { name: 'Copy PR URL' });
    await expect.element(copy).toBeVisible();
    await userEvent.tab();
    await expect.element(copy).toHaveFocus();
  });

  it('keeps task navigation, selection, and PR controls as independent siblings', async () => {
    const openTask = vi.fn();
    const selectTask = vi.fn();
    render(
      <TaskRowInteractionSurface taskName="Investigate badge behavior" onOpen={openTask}>
        <div onClick={(event) => event.stopPropagation()}>
          <button
            type="button"
            role="checkbox"
            aria-checked="false"
            aria-label="Select task"
            onClick={() => selectTask()}
          />
        </div>
        <span>Investigate badge behavior</span>
        <PrBadge pr={pr} hoverDelay={0} />
      </TaskRowInteractionSurface>
    );

    expect(container.querySelector('button button')).toBeNull();

    const taskNavigation = page.getByRole('button', {
      name: 'Open task: Investigate badge behavior',
    });
    await userEvent.tab();
    await expect.element(taskNavigation).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(openTask).toHaveBeenCalledOnce();

    await userEvent.click(page.getByText('Investigate badge behavior'));
    expect(openTask).toHaveBeenCalledTimes(2);

    await userEvent.click(page.getByRole('checkbox', { name: 'Select task' }));
    expect(selectTask).toHaveBeenCalledOnce();
    expect(openTask).toHaveBeenCalledTimes(2);

    await userEvent.click(page.getByRole('button', { name: accessibleName }));
    expect(mocks.openExternal).toHaveBeenCalledOnce();
    expect(openTask).toHaveBeenCalledTimes(2);

    await userEvent.click(page.getByRole('button', { name: detailsAccessibleName }));
    expect(openTask).toHaveBeenCalledTimes(2);
  });

  it('improves the changes-panel PR navigation affordance', async () => {
    render(<PullRequestEntryHeader pr={pr} />);
    const navigation = page.getByRole('button', { name: accessibleName });

    expect(container.querySelector('button button')).toBeNull();
    await expect.element(navigation).toHaveClass(/cursor-pointer/);
    await expect.element(navigation).toHaveClass(/hover:bg-background-1/);
    await expect.element(navigation).toHaveClass(/focus-visible:ring-2/);
    await userEvent.click(navigation);

    expect(mocks.openExternal).toHaveBeenCalledOnce();
    expect(mocks.openExternal).toHaveBeenCalledWith(pr.url);
  });

  function render(node: ReactNode) {
    flushSync(() => root.render(node));
  }
});
