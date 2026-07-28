import type { Meta, StoryObj } from '@storybook/react-vite';
import { FolderGit2Icon, FolderIcon, GitBranchIcon, type LucideIcon } from 'lucide-react';
import * as React from 'react';
import { Button } from '../../primitives/button';
import {
  HierarchicalList,
  HierarchicalListCell,
  type HierarchicalListNode,
  type HierarchicalListRowCells,
} from './hierarchical-list';

const meta: Meta = {
  title: 'Components/HierarchicalList',
  parameters: { layout: 'padded' },
};
export default meta;
type Story = StoryObj;

interface WorkspaceNodeData {
  name: string;
  fullPath: string;
  kind: 'directory' | 'repository' | 'worktree';
  git?: {
    branch: string;
    added: number;
    removed: number;
    ahead: number;
    behind: number;
  };
  sizeLabel: string;
  artifactsLabel: string;
  lastUsedLabel: string;
  linkedTasksLabel: string;
}

const WORKSPACE_TREE: HierarchicalListNode<WorkspaceNodeData>[] = [
  {
    id: 'dir-documents',
    data: {
      name: 'Documents',
      fullPath: '/Users/david/Documents',
      kind: 'directory',
      sizeLabel: '1.2 GB',
      artifactsLabel: '0 MB artifacts',
      lastUsedLabel: 'Today',
      linkedTasksLabel: '5 linked tasks',
    },
    children: [
      {
        id: 'repo-emdash',
        data: {
          name: 'emdash',
          fullPath: '/Users/david/Documents/repos/emdash',
          kind: 'repository',
          git: {
            branch: 'main',
            added: 242,
            removed: 121,
            ahead: 2,
            behind: 1,
          },
          sizeLabel: '24 MB',
          artifactsLabel: '20 MB artifacts',
          lastUsedLabel: '2 days ago',
          linkedTasksLabel: '2 linked tasks',
        },
        children: [
          {
            id: 'worktree-emdash-settings',
            data: {
              name: 'feature/settings-redesign',
              fullPath: '/Users/david/Documents/repos/.worktrees/emdash-settings',
              kind: 'worktree',
              git: {
                branch: 'feature/settings-redesign',
                added: 84,
                removed: 32,
                ahead: 4,
                behind: 0,
              },
              sizeLabel: '18 MB',
              artifactsLabel: '6 MB artifacts',
              lastUsedLabel: '4 hours ago',
              linkedTasksLabel: '1 linked task',
            },
          },
          {
            id: 'worktree-emdash-icons',
            data: {
              name: 'feature/status-icons',
              fullPath: '/Users/david/Documents/repos/.worktrees/emdash-icons',
              kind: 'worktree',
              git: {
                branch: 'feature/status-icons',
                added: 126,
                removed: 10,
                ahead: 3,
                behind: 1,
              },
              sizeLabel: '21 MB',
              artifactsLabel: '8 MB artifacts',
              lastUsedLabel: 'Yesterday',
              linkedTasksLabel: '3 linked tasks',
            },
          },
        ],
      },
      {
        id: 'repo-acme',
        data: {
          name: 'acme',
          fullPath: '/Users/david/Documents/repos/acme',
          kind: 'repository',
          git: {
            branch: 'develop',
            added: 12,
            removed: 8,
            ahead: 0,
            behind: 2,
          },
          sizeLabel: '48 MB',
          artifactsLabel: '15 MB artifacts',
          lastUsedLabel: '1 week ago',
          linkedTasksLabel: '0 linked tasks',
        },
        children: [
          {
            id: 'worktree-acme-api',
            data: {
              name: 'api-refactor',
              fullPath: '/Users/david/Documents/repos/.worktrees/acme-api',
              kind: 'worktree',
              git: {
                branch: 'api-refactor',
                added: 65,
                removed: 18,
                ahead: 1,
                behind: 0,
              },
              sizeLabel: '32 MB',
              artifactsLabel: '11 MB artifacts',
              lastUsedLabel: '3 days ago',
              linkedTasksLabel: '1 linked task',
            },
          },
          {
            id: 'worktree-acme-web',
            data: {
              name: 'web-polish',
              fullPath: '/Users/david/Documents/repos/.worktrees/acme-web',
              kind: 'worktree',
              git: {
                branch: 'web-polish',
                added: 34,
                removed: 42,
                ahead: 2,
                behind: 3,
              },
              sizeLabel: '36 MB',
              artifactsLabel: '16 MB artifacts',
              lastUsedLabel: '5 days ago',
              linkedTasksLabel: '2 linked tasks',
            },
          },
        ],
      },
    ],
  },
  {
    id: 'dir-srv-work',
    data: {
      name: 'work',
      fullPath: '/srv/work',
      kind: 'directory',
      sizeLabel: '832 MB',
      artifactsLabel: '0 MB artifacts',
      lastUsedLabel: 'Today',
      linkedTasksLabel: '4 linked tasks',
    },
    children: [
      {
        id: 'repo-sandbox',
        data: {
          name: 'sandbox',
          fullPath: '/srv/work/sandbox',
          kind: 'repository',
          git: {
            branch: 'main',
            added: 4,
            removed: 0,
            ahead: 1,
            behind: 0,
          },
          sizeLabel: '16 MB',
          artifactsLabel: '2 MB artifacts',
          lastUsedLabel: '6 hours ago',
          linkedTasksLabel: '1 linked task',
        },
        children: [
          {
            id: 'worktree-sandbox-experiment',
            data: {
              name: 'experiment',
              fullPath: '/srv/work/.worktrees/sandbox-experiment',
              kind: 'worktree',
              git: {
                branch: 'experiment',
                added: 242,
                removed: 121,
                ahead: 2,
                behind: 1,
              },
              sizeLabel: '24 MB',
              artifactsLabel: '20 MB artifacts',
              lastUsedLabel: '2 days ago',
              linkedTasksLabel: '2 linked tasks',
            },
          },
        ],
      },
    ],
  },
];

const ICONS: Record<WorkspaceNodeData['kind'], LucideIcon> = {
  directory: FolderIcon,
  repository: FolderGit2Icon,
  worktree: GitBranchIcon,
};

function renderWorkspaceCells(
  node: HierarchicalListNode<WorkspaceNodeData>
): HierarchicalListRowCells {
  const Icon = ICONS[node.data.kind];
  const { git } = node.data;

  return {
    icon: (
      <Icon
        style={{
          width: '1rem',
          height: '1rem',
          color: 'currentColor',
        }}
      />
    ),
    path: <HierarchicalListCell primary={node.data.name} secondary={node.data.fullPath} />,
    gitStatus: git ? (
      <HierarchicalListCell
        primary={git.branch}
        secondary={
          <>
            <span style={{ color: 'var(--em-status-success)' }}>+{git.added}</span>{' '}
            <span style={{ color: 'var(--em-status-error)' }}>-{git.removed}</span>{' '}
            <span>↑{git.ahead}</span> <span>↓{git.behind}</span>
          </>
        }
      />
    ) : undefined,
    storage: (
      <HierarchicalListCell primary={node.data.sizeLabel} secondary={node.data.artifactsLabel} />
    ),
    usage: (
      <HierarchicalListCell
        primary={node.data.lastUsedLabel}
        secondary={node.data.linkedTasksLabel}
      />
    ),
  };
}

export const ThreeLevelHierarchy: Story = {
  name: '3-level workspace hierarchy',
  render: () => (
    <div style={{ width: '48rem', maxWidth: '100%', height: '28rem' }}>
      <HierarchicalList nodes={WORKSPACE_TREE} renderCells={renderWorkspaceCells} />
    </div>
  ),
};

function InteractiveSelectionDemo() {
  const [selectedIds, setSelectedIds] = React.useState<ReadonlySet<string>>(new Set());

  return (
    <div
      style={{
        width: '48rem',
        maxWidth: '100%',
        height: '28rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.75rem',
      }}
    >
      <p
        style={{
          margin: 0,
          fontSize: 'var(--em-text-xs)',
          color: 'var(--em-foreground-muted)',
        }}
      >
        Click to select, Shift-click for range, Alt-click to toggle.
      </p>
      <div style={{ minHeight: 0, flex: 1 }}>
        <HierarchicalList
          nodes={WORKSPACE_TREE}
          selectedIds={selectedIds}
          onSelectedIdsChange={setSelectedIds}
          renderCells={renderWorkspaceCells}
        />
      </div>
      <div
        style={{
          padding: '0.5rem 0.75rem',
          borderRadius: 'var(--em-radius-md)',
          border: '1px solid var(--em-border)',
          backgroundColor: 'var(--em-surface-overlay)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.75rem',
        }}
      >
        <span
          style={{
            minWidth: 0,
            flex: 1,
            color: 'var(--em-foreground)',
            fontSize: 'var(--em-text-sm)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {selectedIds.size > 0
            ? `${selectedIds.size} selected: ${Array.from(selectedIds).join(', ')}`
            : 'No rows selected'}
        </span>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setSelectedIds(new Set())}
          disabled={selectedIds.size === 0}
        >
          Clear
        </Button>
      </div>
    </div>
  );
}

export const InteractiveSelection: Story = {
  name: 'Interactive selection',
  render: () => <InteractiveSelectionDemo />,
};
