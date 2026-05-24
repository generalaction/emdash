import { Plus } from 'lucide-react';
import { cn } from '@renderer/utils/utils';

interface AddCommentButtonProps {
  pinned: boolean;
  onClick: () => void;
}

export function AddCommentButton({ pinned, onClick }: AddCommentButtonProps) {
  return (
    <button
      type="button"
      className={cn(
        'flex h-[22px] w-[22px] cursor-pointer items-center justify-center rounded-md border transition-colors',
        pinned
          ? 'border-border bg-background-2 text-foreground'
          : 'border-transparent bg-transparent text-foreground-muted hover:border-border hover:bg-background-2 hover:text-foreground'
      )}
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
    >
      <Plus className="size-3" />
    </button>
  );
}
