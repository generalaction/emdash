import { ArrowLeftIcon, EllipsisIcon, Trash2Icon } from 'lucide-react';
import * as React from 'react';
import { Button } from '../../primitives/button';
import { DropdownMenu } from '../../primitives/dropdown-menu';
import { Tabs } from '../../primitives/tabs/tabs';
import { ColumnListCell } from '../column-list/column-list';
import {
  WorkspaceIcon,
  type WorkspaceIconStatus,
  type WorkspaceIconType,
} from '../workspace-icon/workspace-icon';
import * as styles from './workspace-detail.css';

export interface WorkspaceDetailGitStats {
  added: number;
  removed: number;
  ahead: number;
  behind: number;
}

export interface WorkspaceDetailViewProps {
  name: string;
  path: string;
  kind: WorkspaceIconType;
  status?: WorkspaceIconStatus;
  branch?: string;
  git?: WorkspaceDetailGitStats;
  worktreeCount: number;
  linkedTaskCount: number;
  onBack: () => void;
  onDelete: () => void;
  worktreesSlot?: React.ReactNode;
  tasksSlot?: React.ReactNode;
  className?: string;
}

function WorkspaceDetailView({
  name,
  path,
  kind,
  status,
  branch,
  git,
  worktreeCount,
  linkedTaskCount,
  onBack,
  onDelete,
  worktreesSlot,
  tasksSlot,
  className,
}: WorkspaceDetailViewProps) {
  return (
    <div className={className ? `${styles.root} ${className}` : styles.root}>
      <div className={styles.toolbar}>
        <Button type="button" variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeftIcon aria-hidden />
          Go back
        </Button>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger>
            <Button type="button" variant="ghost" size="sm" icon aria-label="Workspace actions">
              <EllipsisIcon aria-hidden />
            </Button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Content align="end">
            <DropdownMenu.Item variant="destructive" onClick={onDelete}>
              <Trash2Icon aria-hidden />
              Delete
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      </div>

      <div className={styles.summary}>
        <WorkspaceIcon type={kind} status={status} size="3rem" />
        <div className={styles.summaryCell}>
          <ColumnListCell primary={name} secondary={path} />
        </div>
        <div className={styles.summaryCell}>
          {branch || git ? (
            <ColumnListCell primary={branch ?? 'No branch'} secondary={<GitStats stats={git} />} />
          ) : null}
        </div>
        <div className={styles.summaryCell}>
          <ColumnListCell
            primary={formatCount(worktreeCount, 'Worktree')}
            secondary={formatCount(linkedTaskCount, 'linked task')}
          />
        </div>
      </div>

      <Tabs.Root defaultValue="worktrees" className={styles.tabs}>
        <Tabs.List>
          <Tabs.Tab value="worktrees">Worktrees</Tabs.Tab>
          <Tabs.Tab value="tasks">Tasks</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="worktrees" className={styles.tabPanel}>
          {worktreesSlot ?? 'Worktrees content placeholder.'}
        </Tabs.Panel>
        <Tabs.Panel value="tasks" className={styles.tabPanel}>
          {tasksSlot ?? 'Tasks content placeholder.'}
        </Tabs.Panel>
      </Tabs.Root>
    </div>
  );
}

function GitStats({ stats }: { stats?: WorkspaceDetailGitStats }) {
  if (!stats) return null;

  return (
    <span className={styles.gitStats}>
      <span className={styles.added}>+{stats.added}</span>
      <span className={styles.removed}>-{stats.removed}</span>
      <span>↑{stats.ahead}</span>
      <span>↓{stats.behind}</span>
    </span>
  );
}

function formatCount(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

export { WorkspaceDetailView };
