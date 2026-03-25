import { Loader2, X } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import React from 'react';
import { FileIcon } from '@renderer/components/FileExplorer/FileIcons';
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
    <div className="flex h-8 shrink-0 items-center overflow-x-auto border-b border-border bg-muted/10 overscroll-x-contain">
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
    <div
      className={cn(
        'flex h-full cursor-pointer items-center gap-1.5 border-r border-border px-3 hover:bg-accent/50',
        isActive && 'bg-background'
      )}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      title={tab.isPreview ? `${tab.path} (preview — double-click to keep)` : tab.path}
    >
      <span className="shrink-0 [&>svg]:h-3 [&>svg]:w-3">
        {showSpinner ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <FileIcon filename={fileName} isDirectory={false} />
        )}
      </span>
      <span className={cn('max-w-[200px] truncate text-xs', tab.isPreview && 'italic')}>
        {fileName}
      </span>
      {tab.isDirty && (
        <span className="text-gray-500" title="Unsaved changes">
          ●
        </span>
      )}
      <button
        className="ml-1 rounded p-0.5 hover:bg-accent"
        onClick={onClose}
        aria-label={`Close ${fileName}`}
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
});
