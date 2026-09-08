import { cx } from '@styles/index';
import { CopyMinusIcon, FilePlusIcon, FolderPlusIcon } from 'lucide-react';
import { Button } from '../../primitives/button';
import { Icon } from '../../primitives/icon';
import * as styles from './file-tree.css';

export type FileTreeDraftKind = 'file' | 'directory';

export interface FileTreeHeaderContext {
  targetPath: string;
  startDraft(kind: FileTreeDraftKind): void;
  collapseAll(): void;
  expandAll(): void;
}

export interface FileTreeHeaderProps extends FileTreeHeaderContext {
  /** Applied to the rendered semantic header root. */
  className?: string;
}

/**
 * Default FileTree command header.
 *
 * The target label and action layout are owned here; commands remain
 * caller-owned callbacks. `className` is applied to the rendered `header`.
 */
export function FileTreeHeader({
  targetPath,
  startDraft,
  collapseAll,
  className,
}: FileTreeHeaderProps) {
  const targetLabel = targetPath ? `New items in ${targetPath}` : 'New items in root';

  return (
    <header className={cx(styles.header, className)}>
      <div className={styles.headerTarget} title={targetLabel}>
        {targetLabel}
      </div>
      <div className={styles.headerActions}>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          icon
          aria-label="New file"
          onClick={() => startDraft('file')}
        >
          <Icon source={FilePlusIcon} />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          icon
          aria-label="New folder"
          onClick={() => startDraft('directory')}
        >
          <Icon source={FolderPlusIcon} />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          icon
          aria-label="Collapse all"
          onClick={collapseAll}
        >
          <Icon source={CopyMinusIcon} />
        </Button>
      </div>
    </header>
  );
}
