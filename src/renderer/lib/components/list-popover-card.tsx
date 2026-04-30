import { motion } from 'framer-motion';
import { type ReactNode } from 'react';
import { cn } from '@renderer/utils/utils';

export function ListPopoverCard({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className="absolute bottom-4 left-6 right-6">
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.98 }}
        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        className={cn(
          'flex items-center gap-2 rounded-md border border-border bg-background-1 px-3 py-2 text-sm',
          className
        )}
      >
        {children}
      </motion.div>
    </div>
  );
}
