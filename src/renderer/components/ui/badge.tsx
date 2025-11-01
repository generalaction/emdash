import React from 'react';
import { cn } from '@/lib/utils';

type Props = React.HTMLAttributes<HTMLSpanElement> & {
  variant?: 'default' | 'secondary' | 'outline';
};

export const Badge: React.FC<Props> = ({ className, variant = 'secondary', ...props }) => {
  const base = 'inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium';
  const styles =
    variant === 'outline'
      ? 'border border-border/70 bg-background text-foreground'
      : variant === 'default'
        ? 'bg-foreground text-background'
        : 'border border-border/70 bg-muted/40 text-foreground';
  return <span className={cn(base, styles, className)} {...props} />;
};

export default Badge;
