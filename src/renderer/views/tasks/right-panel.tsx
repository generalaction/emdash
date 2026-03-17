import { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@renderer/lib/utils';
import { ChangesList } from './diff-viewer/changes-list';
import { EditorFileTree } from './editor/editor-file-tree';
import { useTaskViewContext } from './task-view-context';
import { TerminalsPanel } from './terminals/panel';

export function TaskRightSidebar() {
  const { rightPanelView, setRightPanelView } = useTaskViewContext();

  const renderView = () => {
    switch (rightPanelView) {
      case 'changes':
        return <ChangesList />;
      case 'files':
        return <EditorFileTree />;
      case 'terminals':
        return <TerminalsPanel />;
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 gap-3  p-2">
        <TextButton
          onClick={() => setRightPanelView('changes')}
          active={rightPanelView === 'changes'}
        >
          Changes
        </TextButton>
        <TextButton onClick={() => setRightPanelView('files')} active={rightPanelView === 'files'}>
          Files
        </TextButton>
        <TextButton
          onClick={() => setRightPanelView('terminals')}
          active={rightPanelView === 'terminals'}
        >
          Terminals
        </TextButton>
      </div>
      <div className="min-h-0 flex-1">{renderView()}</div>
    </div>
  );
}

interface TextButtonProps extends HTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  active: boolean;
}

function TextButton({ className, active, ...props }: TextButtonProps) {
  return (
    <button
      className={cn(
        'text-sm font-medium transition-colors',
        active ? 'text-foreground' : 'text-muted-foreground',
        className
      )}
      {...props}
    />
  );
}
