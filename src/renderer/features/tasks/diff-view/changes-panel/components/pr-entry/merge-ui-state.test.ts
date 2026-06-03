import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MergeStateStatus, PullRequest } from '@shared/pull-requests';
import { MergeFooter } from './merge-footer';
import { computeMergeUiState, type MergeUiState } from './merge-ui-state';

function makePr(overrides: Partial<PullRequest> = {}): PullRequest {
  return {
    url: 'https://github.com/acme/repo/pull/1',
    provider: 'github',
    repositoryUrl: 'https://github.com/acme/repo',
    baseRefName: 'main',
    baseRefOid: 'base',
    headRepositoryUrl: 'https://github.com/acme/repo',
    headRefName: 'feature',
    headRefOid: 'head',
    identifier: '#1',
    title: 'Test PR',
    description: null,
    status: 'open',
    isDraft: false,
    additions: null,
    deletions: null,
    changedFiles: null,
    commitCount: null,
    mergeableStatus: 'MERGEABLE',
    mergeStateStatus: 'CLEAN',
    reviewDecision: null,
    createdAt: '2026-05-30T00:00:00.000Z',
    updatedAt: '2026-05-30T00:00:00.000Z',
    author: null,
    labels: [],
    assignees: [],
    checks: [],
    ...overrides,
  };
}

describe('computeMergeUiState', () => {
  it.each(['BLOCKED', 'BEHIND', 'HAS_HOOKS', 'UNSTABLE'] satisfies MergeStateStatus[])(
    'allows bypassing requirements when merge state is %s',
    (mergeStateStatus) => {
      expect(computeMergeUiState(makePr({ mergeStateStatus }))).toMatchObject({
        canMerge: false,
        canBypassRequirements: true,
      });
    }
  );

  it('keeps clean pull requests on the normal merge path', () => {
    expect(computeMergeUiState(makePr({ mergeStateStatus: 'CLEAN' }))).toMatchObject({
      canMerge: true,
      canBypassRequirements: false,
    });
  });

  it.each(['DIRTY', 'UNKNOWN'] satisfies MergeStateStatus[])(
    'does not offer bypass for non-requirement merge state %s',
    (mergeStateStatus) => {
      expect(computeMergeUiState(makePr({ mergeStateStatus }))).toMatchObject({
        canMerge: false,
        canBypassRequirements: false,
      });
    }
  );

  it('does not offer bypass for draft pull requests', () => {
    expect(
      computeMergeUiState(makePr({ isDraft: true, mergeStateStatus: 'BLOCKED' }))
    ).toMatchObject({
      kind: 'draft',
      canMerge: false,
      canBypassRequirements: false,
    });
  });
});

describe('MergeFooter', () => {
  let dom: JSDOM;
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
    vi.stubGlobal('window', dom.window);
    vi.stubGlobal('document', dom.window.document);
    vi.stubGlobal('HTMLElement', dom.window.HTMLElement);
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

    container = dom.window.document.getElementById('root') as HTMLDivElement;
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.unstubAllGlobals();
    dom.window.close();
  });

  function renderFooter(uiState: MergeUiState, bypassRequirements = false) {
    act(() => {
      root.render(
        React.createElement(MergeFooter, {
          uiState,
          mergeActions: [
            {
              value: 'merge',
              label: uiState.canBypassRequirements
                ? 'Bypass rules and merge'
                : 'Merge pull request',
              action: vi.fn(),
            },
          ],
          isMerging: false,
          isMarkingReady: false,
          bypassRequirements,
          onMarkReady: vi.fn(),
          onBypassRequirementsChange: vi.fn(),
        })
      );
    });
  }

  function getMergeButton() {
    return Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.toLowerCase().includes('merge')
    ) as HTMLButtonElement | undefined;
  }

  it('requires acknowledging bypass before enabling the merge action', () => {
    renderFooter(computeMergeUiState(makePr({ mergeStateStatus: 'BLOCKED' })));

    expect(getMergeButton()?.disabled).toBe(true);
    expect(container.textContent).toContain(
      'Merge without waiting for requirements to be met (bypass rules)'
    );
  });

  it('enables the merge action after bypass is acknowledged', () => {
    renderFooter(computeMergeUiState(makePr({ mergeStateStatus: 'BLOCKED' })), true);

    expect(getMergeButton()?.disabled).toBe(false);
    expect(getMergeButton()?.textContent).toContain('Bypass rules and merge');
    expect(container.textContent).not.toContain('Merging is blocked');
  });

  it('keeps the merge action disabled for conflicts', () => {
    renderFooter(computeMergeUiState(makePr({ mergeStateStatus: 'DIRTY' })));

    expect(getMergeButton()?.disabled).toBe(true);
  });
});
