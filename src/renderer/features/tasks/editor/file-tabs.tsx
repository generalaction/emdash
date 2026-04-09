import { Loader2, X } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import React from 'react';
import { ReorderList } from '@renderer/lib/components/reorder-list';
import { FileIcon } from '@renderer/lib/editor/file-icon';
import { EditorTab } from '@renderer/lib/editor/types';
import { useDelayedBoolean } from '@renderer/lib/hooks/use-delay-boolean';
import { useModelStatus } from '@renderer/lib/monaco/use-model';
import { Separator } from '@renderer/lib/ui/separator';
import { cn } from '@renderer/utils/utils';

export type RichTab = EditorTab & { isDirty: boolean; bufferUri: string };

interface FileTabsProps {
  tabs: RichTab[];
  activeTabId: string | null;
  onTabClick: (tabId: string) => void;
  onTabClose: (tabId: string) => void;
  onPinTab: (tabId: string) => void;
  onReorder?: (fromIndex: number, toIndex: number) => void;
}

export const FileTabs: React.FC<FileTabsProps> = ({
  tabs,
  activeTabId,
  onTabClick,
  onTabClose,
  onPinTab,
  onReorder,
}) => {
  if (tabs.length === 0) {
    return null;
  }

  const handleReorder = (newTabs: RichTab[]) => {
    for (let toIdx = 0; toIdx < newTabs.length; toIdx++) {
      const fromIdx = tabs.findIndex((t) => t.tabId === newTabs[toIdx].tabId);
      if (fromIdx !== toIdx) {
        onReorder?.(fromIdx, toIdx);
        break;
      }
    }
  };

  const renderTab = (tab: RichTab) => (
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
  );

  return (
    <div className="flex h-[41px] shrink-0 border-b border-border bg-background-1">
      {onReorder ? (
        <ReorderList
          items={tabs}
          onReorder={handleReorder}
          axis="x"
          className="flex overflow-x-auto w-full h-full"
          itemClassName="list-none flex h-full"
          getKey={(item) => item.tabId}
        >
          {renderTab}
        </ReorderList>
      ) : (
        <div className="flex overflow-x-auto h-full">{tabs.map(renderTab)}</div>
      )}
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
        <div className="flex items-center pl-3 pr-2 h-full gap-1.5">
          <span className="shrink-0 [&>svg]:h-3 [&>svg]:w-3">
            {showSpinner ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <FileIcon filename={fileName} />
            )}
          </span>
          <span className={cn('max-w-[200px] text-sm truncate p-1', tab.isPreview && 'italic')}>
            {fileName}
          </span>
          <div className="relative size-5 flex items-center justify-center shrink-0">
            {tab.isDirty && (
              <div
                className="size-2 rounded-full bg-foreground group-hover:opacity-0"
                title="Unsaved changes"
              />
            )}
            <button
              className="absolute inset-0 hover:bg-background-2 text-foreground-muted flex items-center justify-center rounded-md opacity-0 group-hover:opacity-100"
              onClick={onClose}
              aria-label={`Close ${fileName}`}
            >
              <X className="size-4" />
            </button>
          </div>
        </div>
      </button>
      <Separator orientation="vertical" />
    </>
  );
});
