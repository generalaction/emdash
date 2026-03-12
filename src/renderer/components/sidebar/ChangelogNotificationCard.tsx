import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';
import type { ChangelogEntry } from '@shared/changelog';
import { ArrowRight, X } from 'lucide-react';

interface ChangelogNotificationCardProps {
  entry: ChangelogEntry;
  onOpen: () => void;
  onDismiss: () => void;
  className?: string;
}

export function ChangelogNotificationCard({
  entry,
  onOpen,
  onDismiss,
  className,
}: ChangelogNotificationCardProps) {
  return (
    <motion.div
      whileTap={{ scale: 0.97 }}
      className={cn(
        'relative rounded-xl border border-border/80 bg-background/80 shadow-sm backdrop-blur',
        className
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full flex-col gap-3 rounded-xl px-3 py-3 text-left transition-colors hover:bg-accent/30"
      >
        <div className="pr-8">
          <h3 className="line-clamp-2 text-sm font-semibold leading-5 text-foreground">
            {entry.title}
          </h3>
        </div>

        <div className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
          <span>Full changelog</span>
          <ArrowRight className="h-3.5 w-3.5" />
        </div>
      </button>

      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onDismiss();
        }}
        className="absolute right-2 top-2 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        aria-label={`Dismiss changelog notification for version ${entry.version}`}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </motion.div>
  );
}
