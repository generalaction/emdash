import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cn } from '@/lib/utils';

type Props = React.HTMLAttributes<HTMLElement> & {
  variant?: 'default' | 'secondary' | 'outline';
  asChild?: boolean;
};

export const Badge: React.FC<Props> = ({
  className,
  variant = 'secondary',
  asChild = false,
  ...props
}) => {
  const Comp = asChild ? Slot : 'span';
  const base = 'inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium';
  const styles =
    variant === 'outline'
      ? 'border border-border/70 bg-background text-foreground'
      : variant === 'default'
        ? 'bg-foreground text-background'
        : 'border border-border/70 bg-muted/40 text-foreground';
  return <Comp className={cn(base, styles, className)} {...props} />;
};

export default Badge;
