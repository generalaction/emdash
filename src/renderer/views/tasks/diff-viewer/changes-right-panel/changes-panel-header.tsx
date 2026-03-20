import { File, History, Minus, Plus } from 'lucide-react';
import { cn } from '@renderer/lib/utils';
import { useGitChangesContext } from '../state/git-changes-provider';
import { useGitViewContext } from '../state/git-view-provider';

export function ChangesPanelHeader() {
  const { activeTab, setActiveTab } = useGitViewContext();
  const { totalFilesChanged, totalLinesAdded, totalLinesDeleted } = useGitChangesContext();
  return (
    <div className="flex gap-2 p-2">
      <button
        onClick={() => setActiveTab('changes')}
        className={cn(
          'flex-1 text-center text-xs transition-colors rounded-lg border border-border h-7 flex items-center justify-center gap-2',
          activeTab === 'changes'
            ? 'text-foreground bg-muted'
            : 'text-muted-foreground hover:text-foreground'
        )}
      >
        <span className="flex items-center justify-center gap-0.5 text-muted-foreground">
          <File className="size-3" />
          {totalFilesChanged}
        </span>
        {totalLinesAdded > 0 && (
          <span className="flex items-center justify-center gap-0.5 text-green-600">
            <Plus className="size-3" />
            {totalLinesAdded}
          </span>
        )}
        {totalLinesDeleted > 0 && (
          <span className="flex items-center justify-center gap-0.5 text-red-600">
            <Minus className="size-3" />
            {totalLinesDeleted}
          </span>
        )}
      </button>
      <button
        onClick={() => setActiveTab('history')}
        className={cn(
          'text-center text-xs transition-colors rounded-lg border border-border size-7 flex items-center justify-center',
          activeTab === 'history'
            ? 'text-foreground bg-muted'
            : 'text-muted-foreground hover:text-foreground'
        )}
      >
        <History className="size-3.5" />
      </button>
    </div>
  );
}
