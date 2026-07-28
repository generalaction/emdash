import * as React from 'react';
import { ColumnList, ColumnListCell, type ColumnListColumn } from '../column-list/column-list';
import {
  WorkspaceIcon,
  type WorkspaceIconStatus,
  type WorkspaceIconType,
} from '../workspace-icon/workspace-icon';

export interface WorkspacesListItem {
  id: string;
  name: string;
  path: string;
  kind: Extract<WorkspaceIconType, 'directory' | 'repository'>;
  status?: WorkspaceIconStatus;
  worktreeCount?: number;
  linkedTaskCount: number;
  lastUsed?: React.ReactNode;
  activeTaskCount: number;
}

export interface WorkspacesListProps {
  items: readonly WorkspacesListItem[];
  onItemClick?: (item: WorkspacesListItem) => void;
  emptySlot?: React.ReactNode;
  className?: string;
}

const WORKSPACE_COLUMNS: ColumnListColumn<WorkspacesListItem>[] = [
  {
    id: 'icon',
    width: '2.25rem',
    cell: (item) => <WorkspaceIcon type={item.kind} status={item.status} />,
  },
  {
    id: 'name',
    width: 'minmax(0, 1fr)',
    cell: (item) => <ColumnListCell primary={item.name} secondary={item.path} />,
  },
  {
    id: 'worktrees',
    width: '10rem',
    cell: (item) =>
      item.worktreeCount === undefined ? null : (
        <ColumnListCell
          primary={formatCount(item.worktreeCount, 'Worktree')}
          secondary={formatCount(item.linkedTaskCount, 'linked task')}
        />
      ),
  },
  {
    id: 'usage',
    width: '10rem',
    cell: (item) => (
      <ColumnListCell
        primary={item.lastUsed ?? 'Never'}
        secondary={formatCount(item.activeTaskCount, 'Task active', 'Tasks active')}
      />
    ),
  },
];

function WorkspacesList({ items, onItemClick, emptySlot, className }: WorkspacesListProps) {
  return (
    <ColumnList
      items={items}
      columns={WORKSPACE_COLUMNS}
      getItemKey={(item) => item.id}
      onItemClick={onItemClick ? (item) => onItemClick(item) : undefined}
      emptySlot={emptySlot}
      className={className}
    />
  );
}

function formatCount(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

export { WorkspacesList };
