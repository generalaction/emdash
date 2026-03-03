import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Check, XCircle } from 'lucide-react';
import { MarkdownRenderer } from './ui/markdown-renderer';
import { Button } from './ui/button';
import { cn } from '@/lib/utils';
import { useTheme } from '@/hooks/useTheme';

interface PlanOverlayProps {
  planContent: string;
  onAccept: () => void;
  onDecline: () => void;
  onDismiss: () => void;
  taskPath?: string | null;
}

export const PlanOverlay: React.FC<PlanOverlayProps> = ({
  planContent,
  onAccept,
  onDecline,
  onDismiss,
  taskPath,
}) => {
  const { effectiveTheme } = useTheme();
  const isDark = effectiveTheme === 'dark' || effectiveTheme === 'dark-black';

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 24 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
        className={cn(
          'absolute inset-0 z-50 flex flex-col overflow-hidden rounded-md border border-border',
          isDark ? 'bg-background/95' : 'bg-background/97'
        )}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center rounded-md bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
              Plan Mode
            </span>
            <span className="text-xs text-muted-foreground">Review the plan before proceeding</span>
          </div>
          <button
            onClick={onDismiss}
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          <div className="mx-auto max-w-3xl">
            <MarkdownRenderer
              content={planContent}
              variant="full"
              rootPath={taskPath ?? undefined}
              className="text-sm"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-border px-4 py-3">
          <Button variant="outline" size="sm" onClick={onDecline} className="gap-1.5">
            <XCircle className="h-3.5 w-3.5" />
            Decline
          </Button>
          <Button
            size="sm"
            onClick={onAccept}
            className="gap-1.5 bg-green-600 text-white hover:bg-green-700"
          >
            <Check className="h-3.5 w-3.5" />
            Accept
          </Button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};
