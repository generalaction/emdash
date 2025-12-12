import React from 'react';
import { motion } from 'motion/react';

type Props = {
  lines?: number;
};

// Skeleton placeholder for the delete-risk warning panel
export const DeleteRiskSkeleton: React.FC<Props> = ({ lines = 2 }) => {
  const items = Array.from({ length: Math.max(1, lines) });

  return (
    <div className="space-y-2 rounded-md border border-border/70 bg-muted/40 px-3 py-2">
      <motion.div
        className="h-3 w-40 rounded bg-muted-foreground/20"
        animate={{ opacity: [0.35, 1, 0.35] }}
        transition={{ duration: 1.1, repeat: Infinity, ease: 'easeInOut' }}
      />
      <div className="space-y-1">
        {items.map((_, idx) => (
          <motion.div
            key={idx}
            className="h-2.5 w-full rounded bg-muted-foreground/15"
            animate={{ opacity: [0.35, 1, 0.35] }}
            transition={{ duration: 1.1, repeat: Infinity, ease: 'easeInOut', delay: idx * 0.12 }}
          />
        ))}
      </div>
    </div>
  );
};

export default DeleteRiskSkeleton;
