import { type MouseEvent, type ReactNode } from 'react';
import { cn } from '@renderer/utils/utils';

interface TaskRowInteractionSurfaceProps {
  taskName: string;
  disabled?: boolean;
  onOpen: () => void;
  children: ReactNode;
}

export function TaskRowInteractionSurface({
  taskName,
  disabled = false,
  onOpen,
  children,
}: TaskRowInteractionSurfaceProps) {
  const handleOpen = () => {
    if (!disabled) onOpen();
  };

  const handleNavigationButtonClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    handleOpen();
  };

  return (
    <div
      className={cn(
        'group relative w-full rounded-lg transition-colors hover:bg-background-1',
        disabled ? 'cursor-default' : 'cursor-pointer'
      )}
      onClick={handleOpen}
    >
      <button
        type="button"
        aria-label={`Open task: ${taskName}`}
        disabled={disabled}
        className="focus-visible:ring-ring/50 pointer-events-none absolute inset-0 rounded-lg outline-none focus-visible:ring-2"
        onClick={handleNavigationButtonClick}
      />
      <div className="relative flex w-full items-center gap-2 p-3">{children}</div>
    </div>
  );
}
