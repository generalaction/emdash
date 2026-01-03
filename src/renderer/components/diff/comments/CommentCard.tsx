import * as React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { Textarea, type TextareaProps } from '../../ui/textarea';
import { cn } from '@/lib/utils';

export function useTextareaAutoFocus(ref: React.RefObject<HTMLTextAreaElement>, active: boolean) {
  React.useEffect(() => {
    if (!active) return;
    const focusTextarea = () => {
      const textarea = ref.current;
      if (!textarea) return;
      textarea.focus();
      textarea.select();
    };

    let raf2: number | null = null;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        focusTextarea();
      });
    });
    const timer = setTimeout(() => {
      focusTextarea();
    }, 80);

    return () => {
      cancelAnimationFrame(raf1);
      if (raf2 !== null) cancelAnimationFrame(raf2);
      clearTimeout(timer);
    };
  }, [active, ref]);
}

const CommentRoot = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <Card ref={ref} className={cn('flex h-[140px] w-full flex-col', className)} {...props} />
  )
);
CommentRoot.displayName = 'CommentRoot';

const CommentHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <CardHeader
      ref={ref}
      className={cn('flex flex-row items-center justify-between space-y-0 px-3 py-2', className)}
      {...props}
    />
  )
);
CommentHeader.displayName = 'CommentHeader';

const CommentTitle = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <CardTitle ref={ref} className={cn('text-sm font-semibold leading-none', className)} {...props} />
));
CommentTitle.displayName = 'CommentTitle';

const CommentMeta = React.forwardRef<HTMLSpanElement, React.HTMLAttributes<HTMLSpanElement>>(
  ({ className, ...props }, ref) => (
    <span
      ref={ref}
      className={cn('text-xs font-normal text-muted-foreground', className)}
      {...props}
    />
  )
);
CommentMeta.displayName = 'CommentMeta';

const CommentActions = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex items-center gap-1.5', className)} {...props} />
  )
);
CommentActions.displayName = 'CommentActions';

const CommentBody = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <CardContent
      ref={ref}
      className={cn('flex-1 overflow-hidden px-3 pb-3 pt-0', className)}
      {...props}
    />
  )
);
CommentBody.displayName = 'CommentBody';

const CommentTextarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => (
    <Textarea ref={ref} className={cn('h-full resize-none text-sm', className)} {...props} />
  )
);
CommentTextarea.displayName = 'CommentTextarea';

export const Comment = {
  Root: CommentRoot,
  Header: CommentHeader,
  Title: CommentTitle,
  Meta: CommentMeta,
  Actions: CommentActions,
  Body: CommentBody,
  Textarea: CommentTextarea,
};
