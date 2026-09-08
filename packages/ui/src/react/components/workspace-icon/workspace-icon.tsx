import { cx } from '@styles/index';
import { FolderGit2Icon, FolderIcon, GitBranchIcon } from 'lucide-react';
import * as React from 'react';
import { Icon, type StaticSvgComponent } from '../../primitives/icon';
import * as styles from './workspace-icon.css';

export type WorkspaceIconType = 'directory' | 'repository' | 'worktree';

export type WorkspaceIconStatus = 'active' | 'idle' | 'setting-up' | 'tearing-down' | 'error';

export interface WorkspaceIconProps extends Omit<
  React.HTMLAttributes<HTMLSpanElement>,
  'children'
> {
  /** Workspace entry kind; determines the glyph. */
  type: WorkspaceIconType;
  /** Optional runtime status rendered as a colored dot on the tile corner. */
  status?: WorkspaceIconStatus;
  /**
   * Uniform size shorthand. Sets the tile bounding box; the glyph and status
   * dot scale with it. Numbers are treated as CSS px values.
   */
  size?: string | number;
}

const TYPE_ICONS: Record<WorkspaceIconType, StaticSvgComponent> = {
  directory: FolderIcon,
  repository: FolderGit2Icon,
  worktree: GitBranchIcon,
};

const TYPE_LABELS: Record<WorkspaceIconType, string> = {
  directory: 'Directory',
  repository: 'Repository',
  worktree: 'Worktree',
};

const STATUS_LABELS: Record<WorkspaceIconStatus, string> = {
  active: 'Active',
  idle: 'Idle',
  'setting-up': 'Setting up',
  'tearing-down': 'Tearing down',
  error: 'Error',
};

function toCssLength(size: string | number) {
  return typeof size === 'number' ? `${size}px` : size;
}

/**
 * WorkspaceIcon — a rounded tile with a workspace-kind glyph (directory,
 * repository, or worktree) and an optional status dot on the bottom-right
 * corner, following the MachineStatus dot conventions. Its semantic status
 * Recipe and caller `className` are applied to the span root; the glyph renders
 * through the owned `Icon` contract.
 */
function WorkspaceIcon({
  type,
  status,
  size = '2.25rem',
  className,
  style,
  role = 'img',
  'aria-label': ariaLabel,
  ...props
}: WorkspaceIconProps) {
  const source = TYPE_ICONS[type];
  const defaultLabel = status
    ? `${TYPE_LABELS[type]} — ${STATUS_LABELS[status]}`
    : TYPE_LABELS[type];

  return (
    <span
      {...props}
      role={role}
      aria-label={ariaLabel ?? defaultLabel}
      data-type={type}
      data-status={status}
      className={cx(styles.workspaceIcon({ status }), className)}
      style={
        {
          '--_workspace-icon-size': toCssLength(size),
          ...style,
        } as React.CSSProperties
      }
    >
      <Icon source={source} />
      {status !== undefined && <span className={styles.statusDot} aria-hidden />}
    </span>
  );
}

export { WorkspaceIcon };
