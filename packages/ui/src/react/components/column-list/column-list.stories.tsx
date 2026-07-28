import type { Meta, StoryObj } from '@storybook/react-vite';
import * as React from 'react';
import {
  WorkspaceIcon,
  type WorkspaceIconStatus,
  type WorkspaceIconType,
} from '../workspace-icon/workspace-icon';
import { ColumnList, ColumnListCell, type ColumnListColumn } from './column-list';

const meta: Meta = {
  title: 'Components/ColumnList',
  parameters: { layout: 'padded' },
};
export default meta;
type Story = StoryObj;

interface WorkspaceRow {
  id: string;
  name: string;
  fullPath: string;
  kind: WorkspaceIconType;
  status?: WorkspaceIconStatus;
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

const WORKSPACE_ROWS: WorkspaceRow[] = [
  {
    id: 'dir-documents',
    name: 'Documents',
    fullPath: '/Users/david/Documents',
    kind: 'directory',
    status: 'idle',
    sizeLabel: '1.2 GB',
    artifactsLabel: '0 MB artifacts',
    lastUsedLabel: 'Today',
    linkedTasksLabel: '5 linked tasks',
  },
  {
    id: 'dir-srv-work',
    name: 'work',
    fullPath: '/srv/work',
    kind: 'directory',
    status: 'idle',
    sizeLabel: '832 MB',
    artifactsLabel: '0 MB artifacts',
    lastUsedLabel: 'Today',
    linkedTasksLabel: '4 linked tasks',
  },
  {
    id: 'repo-emdash',
    name: 'emdash',
    fullPath: '/Users/david/Documents/repos/emdash',
    kind: 'repository',
    status: 'active',
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
  {
    id: 'worktree-emdash-settings',
    name: 'feature/settings-redesign',
    fullPath: '/Users/david/Documents/repos/.worktrees/emdash-settings',
    kind: 'worktree',
    status: 'setting-up',
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
  {
    id: 'worktree-emdash-icons',
    name: 'feature/status-icons',
    fullPath: '/Users/david/Documents/repos/.worktrees/emdash-icons',
    kind: 'worktree',
    status: 'active',
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
  {
    id: 'repo-acme',
    name: 'acme',
    fullPath: '/Users/david/Documents/repos/acme',
    kind: 'repository',
    status: 'tearing-down',
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
  {
    id: 'worktree-acme-api',
    name: 'api-refactor',
    fullPath: '/Users/david/Documents/repos/.worktrees/acme-api',
    kind: 'worktree',
    status: 'idle',
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
  {
    id: 'worktree-acme-web',
    name: 'web-polish',
    fullPath: '/Users/david/Documents/repos/.worktrees/acme-web',
    kind: 'worktree',
    status: 'error',
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
  {
    id: 'repo-sandbox',
    name: 'sandbox',
    fullPath: '/srv/work/sandbox',
    kind: 'repository',
    status: 'idle',
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
  {
    id: 'worktree-sandbox-experiment',
    name: 'experiment',
    fullPath: '/srv/work/.worktrees/sandbox-experiment',
    kind: 'worktree',
    status: 'active',
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
];

const WORKSPACE_COLUMNS: ColumnListColumn<WorkspaceRow>[] = [
  {
    id: 'icon',
    width: '2.25rem',
    cell: (row) => <WorkspaceIcon type={row.kind} status={row.status} />,
  },
  {
    id: 'path',
    width: 'minmax(0, 1fr)',
    cell: (row) => <ColumnListCell primary={row.name} secondary={row.fullPath} />,
  },
  {
    id: 'gitStatus',
    width: '9rem',
    cell: (row) =>
      row.git ? (
        <ColumnListCell
          primary={row.git.branch}
          secondary={
            <>
              <span style={{ color: 'var(--em-foreground-success)' }}>+{row.git.added}</span>{' '}
              <span style={{ color: 'var(--em-foreground-error)' }}>-{row.git.removed}</span>{' '}
              <span>↑{row.git.ahead}</span> <span>↓{row.git.behind}</span>
            </>
          }
        />
      ) : undefined,
  },
  {
    id: 'storage',
    width: '8rem',
    cell: (row) => <ColumnListCell primary={row.sizeLabel} secondary={row.artifactsLabel} />,
  },
  {
    id: 'usage',
    width: '9rem',
    cell: (row) => <ColumnListCell primary={row.lastUsedLabel} secondary={row.linkedTasksLabel} />,
  },
];

function WorkspaceRowsDemo() {
  const [clickedRowId, setClickedRowId] = React.useState<string | null>(null);

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
      <div style={{ minHeight: 0, flex: 1 }}>
        <ColumnList
          items={WORKSPACE_ROWS}
          columns={WORKSPACE_COLUMNS}
          getItemKey={(row) => row.id}
          onItemClick={(row) => setClickedRowId(row.id)}
        />
      </div>
      <p
        style={{
          margin: 0,
          color: 'var(--em-foreground-muted)',
          fontSize: 'var(--em-text-xs)',
        }}
      >
        {clickedRowId === null
          ? 'Click a row to fire onItemClick.'
          : `Last clicked: ${clickedRowId}`}
      </p>
    </div>
  );
}

export const WorkspaceRows: Story = {
  name: 'Workspace rows',
  render: () => <WorkspaceRowsDemo />,
};

export const Empty: Story = {
  render: () => (
    <div style={{ width: '48rem', maxWidth: '100%', height: '12rem' }}>
      <ColumnList
        items={[]}
        columns={WORKSPACE_COLUMNS}
        getItemKey={(row) => row.id}
        emptySlot={
          <div
            style={{
              padding: '2rem',
              textAlign: 'center',
              color: 'var(--em-foreground-muted)',
              fontSize: 'var(--em-text-sm)',
            }}
          >
            No workspaces found.
          </div>
        }
      />
    </div>
  ),
};
