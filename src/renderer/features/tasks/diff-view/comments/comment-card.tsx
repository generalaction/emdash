import React, { useEffect } from 'react';
import { Textarea, type TextareaProps } from '@renderer/lib/ui/textarea';
import { cn } from '@renderer/utils/utils';

export function useTextareaAutoFocus(
  ref: React.RefObject<HTMLTextAreaElement | null>,
  active: boolean
) {
  useEffect(() => {
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

type DivProps = React.HTMLAttributes<HTMLDivElement> & { ref?: React.Ref<HTMLDivElement> };
type SpanProps = React.HTMLAttributes<HTMLSpanElement> & { ref?: React.Ref<HTMLSpanElement> };
type CommentTextareaProps = TextareaProps & { ref?: React.Ref<HTMLTextAreaElement> };

const CommentRoot = ({ className, ref, ...props }: DivProps) => (
  <div
    ref={ref}
    className={cn(
      'flex h-[140px] w-full flex-col rounded-lg border border-border bg-background text-foreground shadow-sm',
      className
    )}
    {...props}
  />
);

const CommentHeader = ({ className, ref, ...props }: DivProps) => (
  <div
    ref={ref}
    className={cn('flex flex-row items-center justify-between space-y-0 px-6 py-4 pb-3', className)}
    {...props}
  />
);

const CommentTitle = ({ className, ref, ...props }: DivProps) => (
  <div ref={ref} className={cn('text-sm font-semibold leading-none', className)} {...props} />
);

const CommentMeta = ({ className, ref, ...props }: SpanProps) => (
  <span
    ref={ref}
    className={cn('text-xs font-normal text-muted-foreground', className)}
    {...props}
  />
);

const CommentActions = ({ className, ref, ...props }: DivProps) => (
  <div ref={ref} className={cn('flex items-center gap-1.5', className)} {...props} />
);

const CommentBody = ({ className, ref, ...props }: DivProps) => (
  <div ref={ref} className={cn('flex-1 overflow-hidden px-6 pb-5 pt-0', className)} {...props} />
);

const CommentTextarea = ({ className, ref, ...props }: CommentTextareaProps) => (
  <Textarea
    ref={ref}
    className={cn(
      'h-full resize-none border-border bg-background px-4 py-3 text-sm shadow-none focus-visible:ring-0 focus-visible:border-border focus-visible:outline-none',
      className
    )}
    {...props}
  />
);

export const Comment = {
  Root: CommentRoot,
  Header: CommentHeader,
  Title: CommentTitle,
  Meta: CommentMeta,
  Actions: CommentActions,
  Body: CommentBody,
  Textarea: CommentTextarea,
};
