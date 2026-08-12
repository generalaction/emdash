import type { Commit } from '@emdash/core/runtimes/git/api';
import { ContextMenu } from '@emdash/ui/react/primitives';
import { Copy, FileText, Info } from 'lucide-react';
import type { ReactNode } from 'react';
import { commitFullMessage, copyCommitValue } from './commit-clipboard';

interface CommitContextMenuProps {
  children: ReactNode;
  commit: Commit;
  onViewDetails: () => void;
}

export function CommitContextMenu({ children, commit, onViewDetails }: CommitContextMenuProps) {
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger>{children}</ContextMenu.Trigger>
      <ContextMenu.Content>
        <ContextMenu.Item onClick={onViewDetails}>
          <Info className="size-4" />
          View commit details
        </ContextMenu.Item>
        <ContextMenu.Separator />
        <ContextMenu.Item onClick={() => void copyCommitValue(commit.hash, 'Commit SHA')}>
          <Copy className="size-4" />
          Copy commit SHA
        </ContextMenu.Item>
        <ContextMenu.Item
          onClick={() => void copyCommitValue(commitFullMessage(commit), 'Commit message')}
        >
          <FileText className="size-4" />
          Copy commit message
        </ContextMenu.Item>
      </ContextMenu.Content>
    </ContextMenu.Root>
  );
}
