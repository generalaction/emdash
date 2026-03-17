import { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@renderer/lib/utils';
import { ChangesList } from './diff-viewer/changes-list';
import { EditorFileTree } from './editor/editor-file-tree';
import { useTaskViewContext } from './task-view-context';
import { TerminalsPanel } from './terminals/panel';

export function TaskRightSidebar() {
  const { rightPanelView } = useTaskViewContext();

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

  return <div className="flex h-full flex-col">{renderView()}</div>;
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
