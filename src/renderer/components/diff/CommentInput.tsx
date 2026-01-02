import React, { useState, useRef, useEffect } from 'react';
import { Check, X } from 'lucide-react';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip';

interface CommentInputProps {
  lineNumber: number;
  lineContent?: string;
  side: 'original' | 'modified';
  existingContent?: string;
  onSubmit: (content: string) => void;
  onCancel: () => void;
  theme: 'light' | 'dark';
}

export const CommentInput: React.FC<CommentInputProps> = ({
  lineNumber,
  existingContent,
  onSubmit,
  onCancel,
}) => {
  const [content, setContent] = useState(existingContent || '');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const focusTextarea = () => {
      const textarea = textareaRef.current;
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
  }, []);

  const handleSubmit = () => {
    if (content.trim()) {
      onSubmit(content.trim());
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === 'Escape') {
      onCancel();
    }
  };

  return (
    <Card className="flex h-[140px] w-full flex-col">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 px-3 py-2">
        <CardTitle className="text-sm font-semibold leading-none">
          {existingContent ? 'Edit comment' : 'Add comment'}
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            (Line {lineNumber})
          </span>
        </CardTitle>
        <TooltipProvider delayDuration={400}>
          <div className="flex items-center gap-1.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={onCancel}
                >
                  <X className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">
                Cancel (Esc)
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={handleSubmit}
                  disabled={!content.trim()}
                >
                  <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">
                Submit (⌘+Enter)
              </TooltipContent>
            </Tooltip>
          </div>
        </TooltipProvider>
      </CardHeader>

      <CardContent className="flex-1 overflow-hidden px-3 pb-3 pt-0">
        <Textarea
          ref={textareaRef}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Add a note about this line…"
          className="h-full resize-none text-sm"
          autoFocus
        />
      </CardContent>
    </Card>
  );
};
