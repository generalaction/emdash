import React from 'react';
import { FolderOpen, X, PanelRight, Save } from 'lucide-react';
import { Button } from '../ui/button';

interface EditorHeaderProps {
  taskName: string;
  hasUnsavedChanges: boolean;
  isSaving: boolean;
  rightSidebarCollapsed: boolean;
  onSaveAll: () => void;
  onToggleRightSidebar: () => void;
  onClose: () => void;
}

export const EditorHeader: React.FC<EditorHeaderProps> = ({
  taskName,
  hasUnsavedChanges,
  isSaving,
  rightSidebarCollapsed,
  onSaveAll,
  onToggleRightSidebar,
  onClose,
}) => {
  return (
    <div className="flex h-9 items-center justify-between border-b border-border bg-muted/30 px-3">
      <TaskInfo taskName={taskName} hasUnsavedChanges={hasUnsavedChanges} />
      <EditorControls
        hasUnsavedChanges={hasUnsavedChanges}
        isSaving={isSaving}
        rightSidebarCollapsed={rightSidebarCollapsed}
        onSaveAll={onSaveAll}
        onToggleRightSidebar={onToggleRightSidebar}
        onClose={onClose}
      />
    </div>
  );
};

const TaskInfo: React.FC<{
  taskName: string;
  hasUnsavedChanges: boolean;
}> = ({ taskName, hasUnsavedChanges }) => (
  <div className="flex items-center gap-2">
    <FolderOpen className="h-4 w-4 text-muted-foreground" />
    <span className="text-sm font-medium">{taskName}</span>
    {hasUnsavedChanges && <span className="text-xs text-amber-500">● Unsaved changes</span>}
  </div>
);

const EditorControls: React.FC<{
  hasUnsavedChanges: boolean;
  isSaving: boolean;
  rightSidebarCollapsed: boolean;
  onSaveAll: () => void;
  onToggleRightSidebar: () => void;
  onClose: () => void;
}> = ({
  hasUnsavedChanges,
  isSaving,
  rightSidebarCollapsed,
  onSaveAll,
  onToggleRightSidebar,
  onClose,
}) => (
  <div className="flex items-center gap-1">
    <Button
      variant="ghost"
      size="icon"
      className="h-7 w-7"
      onClick={onSaveAll}
      disabled={!hasUnsavedChanges || isSaving}
      title="Save All (⌘⇧S)"
    >
      <Save className="h-3.5 w-3.5" />
    </Button>
    <Button
      variant="ghost"
      size="icon"
      className="h-7 w-7"
      onClick={onToggleRightSidebar}
      title={rightSidebarCollapsed ? 'Show Changes' : 'Hide Changes'}
    >
      <PanelRight className="h-3.5 w-3.5" />
    </Button>
    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose} title="Close Editor">
      <X className="h-3.5 w-3.5" />
    </Button>
  </div>
);

export default EditorHeader;
