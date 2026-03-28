import { Loader2, X } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import React from 'react';
import { FileIcon } from '@renderer/components/FileExplorer/FileIcons';
import { Separator } from '@renderer/components/ui/separator';
import { EditorTab } from '@renderer/core/editor/types';
import { useModelStatus } from '@renderer/core/monaco/use-model';
import { useDelayedBoolean } from '@renderer/hooks/use-delay-boolean';
import { cn } from '@renderer/lib/utils';

export type RichTab = EditorTab & { isDirty: boolean; bufferUri: string };

interface FileTabsProps {
  tabs: RichTab[];
  activeTabId: string | null;
  onTabClick: (tabId: string) => void;
  onTabClose: (tabId: string) => void;
  onPinTab: (tabId: string) => void;
}

export const FileTabs: React.FC<FileTabsProps> = ({
  tabs,
  activeTabId,
  onTabClick,
  onTabClose,
  onPinTab,
}) => {
  if (tabs.length === 0) {
    return null;
  }

  return (
    <div className="flex h-[41px] shrink-0 overflow-x-auto border-b border-border bg-background-1">
      {tabs.map((tab) => (
        <FileTab
          key={tab.tabId}
          tab={tab}
          isActive={tab.tabId === activeTabId}
          onClick={() => onTabClick(tab.tabId)}
          onDoubleClick={() => onPinTab(tab.tabId)}
          onClose={(e) => {
            e.stopPropagation();
            onTabClose(tab.tabId);
          }}
        />
      ))}
    </div>
  );
};

interface FileTabProps {
  tab: RichTab;
  isActive: boolean;
  onClick: () => void;
  onDoubleClick: () => void;
  onClose: (e: React.MouseEvent) => void;
}

const FileTab: React.FC<FileTabProps> = observer(function FileTab({
  tab,
  isActive,
  onClick,
  onDoubleClick,
  onClose,
}) {
  const fileName = tab.path.split('/').pop() || 'Untitled';
  const isMonacoFile = tab.kind === 'text' || tab.kind === 'markdown' || tab.kind === 'svg';
  const modelStatus = useModelStatus(tab.bufferUri);
  const showSpinner = useDelayedBoolean(isMonacoFile && modelStatus === 'loading', 200);

  return (
    <>
      <button
        className={cn(
          'group relative bg-background-1 flex flex-col h-full text-sm hover:bg-muted',
          isActive && 'bg-background opacity-100 [box-shadow:inset_0_1px_0_var(--primary)]'
        )}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        title={tab.isPreview ? `${tab.path} (preview — double-click to keep)` : tab.path}
      >
        <div className="flex items-center pl-3 pr-1 h-full gap-1.5">
          <span className="shrink-0 [&>svg]:h-3 [&>svg]:w-3">
            {showSpinner ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <FileIcon filename={fileName} isDirectory={false} />
            )}
          </span>
          <span className={cn('max-w-[200px] truncate p-1', tab.isPreview && 'italic')}>
            {fileName}
          </span>
          {tab.isDirty && (
            <span className="text-foreground-muted" title="Unsaved changes">
              ●
            </span>
          )}
          <button
            className="size-5 hover:bg-background-2 text-foreground-muted flex items-center justify-center rounded-md opacity-0 group-hover:opacity-100"
            onClick={onClose}
            aria-label={`Close ${fileName}`}
          >
            <X className="size-4" />
          </button>
        </div>
      </button>
      <Separator orientation="vertical" />
    </>
  );
});
