import React, { useState } from 'react';
import { X } from 'lucide-react';
import { useFileChanges } from '../../hooks/useFileChanges';
import { ChangesTab } from './ChangesTab';
import { HistoryTab } from './HistoryTab';

interface DiffViewerProps {
  onClose: () => void;
  taskId?: string;
  taskPath?: string;
  initialFile?: string | null;
}

type Tab = 'changes' | 'history';

export const DiffViewer: React.FC<DiffViewerProps> = ({
  onClose,
  taskId,
  taskPath,
  initialFile,
}) => {
  const [activeTab, setActiveTab] = useState<Tab>('changes');
  const { fileChanges, refreshChanges } = useFileChanges(taskPath);
  const fileCount = fileChanges.length;
  const [leftPanelSize, setLeftPanelSize] = useState(30);

  const tabHeader = (
    <div className="flex h-9 border-b border-border bg-muted/50">
      <button
        onClick={() => setActiveTab('changes')}
        className={`flex-1 text-center text-sm font-medium transition-colors ${
          activeTab === 'changes'
            ? 'border-b-2 border-foreground text-foreground'
            : 'text-muted-foreground hover:text-foreground'
        }`}
      >
        Changes{fileCount > 0 ? ` (${fileCount})` : ''}
      </button>
      <button
        onClick={() => setActiveTab('history')}
        className={`flex-1 text-center text-sm font-medium transition-colors ${
          activeTab === 'history'
            ? 'border-b-2 border-foreground text-foreground'
            : 'text-muted-foreground hover:text-foreground'
        }`}
      >
        History
      </button>
    </div>
  );

  const closeButton = (
    <button
      onClick={onClose}
      className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      aria-label="Close diff viewer"
    >
      <X className="h-4 w-4" />
    </button>
  );

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="min-h-0 flex-1 overflow-hidden">
        {activeTab === 'changes' ? (
          <ChangesTab
            taskId={taskId}
            taskPath={taskPath}
            fileChanges={fileChanges}
            onRefreshChanges={refreshChanges}
            header={tabHeader}
            closeButton={closeButton}
            leftPanelSize={leftPanelSize}
            onLeftPanelResize={setLeftPanelSize}
            initialFile={initialFile}
          />
        ) : (
          <HistoryTab
            taskPath={taskPath}
            header={tabHeader}
            closeButton={closeButton}
            leftPanelSize={leftPanelSize}
            onLeftPanelResize={setLeftPanelSize}
          />
        )}
      </div>
    </div>
  );
};
