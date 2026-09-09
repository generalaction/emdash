import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const desktopRoot = resolve(import.meta.dirname, '../../../../..');

const productSemanticConsumers = [
  'src/core/features/automations/browser/components/AutomationRow.tsx',
  'src/core/features/automations/browser/components/RunStatusBadge.tsx',
  'src/core/features/projects/browser/components/pr-view/pr-row.tsx',
  'src/core/features/source-control/browser/diff-view/changes-panel/components/changes-list-item.tsx',
  'src/core/features/source-control/browser/diff-view/changes-panel/components/commit-card.tsx',
  'src/core/features/source-control/browser/diff-view/changes-panel/components/pr-entry/checks-list.tsx',
  'src/core/features/source-control/browser/diff-view/changes-panel/components/pr-entry/merge-footer.tsx',
  'src/core/features/source-control/browser/diff-view/comments/comment-input.tsx',
  'src/core/features/source-control/browser/diff-view/comments/comment-widget.tsx',
  'src/core/features/source-control/browser/diff-view/main-panel/stacked-diff-view.tsx',
  'src/core/features/tasks/browser/components/issue-selector/issue-status-indicator.tsx',
  'src/core/features/tasks/browser/task-config/existing-workspace-picker.tsx',
  'src/core/features/tasks/browser/task-titlebar.tsx',
  'src/core/features/tasks/contributions/browser/task-git-diff-stats.tsx',
  'src/core/features/workspaces/contributions/browser/git-stats-cell.tsx',
  'src/core/features/workspaces/contributions/browser/repository-header.tsx',
  'src/core/services/pull-requests/browser/components/pr-status-icon.tsx',
] as const;

const genericFeedbackUtility =
  /\b(?:text|bg|border|fill)-(?:foreground-(?:conflict|destructive|diff-added|diff-deleted|diff-modified|error|info|merged|success|warning)|background-(?:error|info|success|warning)|border-(?:error|info|success|warning)|status-(?:done|in-progress|in-review)(?:-hover)?|(?:amber|green|orange|purple|red|yellow)-\d+)\b/g;

describe('desktop product Recipe convergence', () => {
  it('has zero VCS, diff, and workflow consumers using generic feedback utilities', () => {
    const consumers = productSemanticConsumers.flatMap((path) => {
      const source = readFileSync(resolve(desktopRoot, path), 'utf8');
      return [...source.matchAll(genericFeedbackUtility)].map((match) => `${path}: ${match[0]}`);
    });

    expect(consumers).toEqual([]);
  });
});
