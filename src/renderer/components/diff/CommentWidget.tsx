import React, { useState } from 'react';
import { Check, X, Pencil, Trash2 } from 'lucide-react';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { RelativeTime } from '../ui/relative-time';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip';

interface LineComment {
  id: string;
  taskId: string;
  filePath: string;
  lineNumber: number;
  lineContent?: string | null;
  side: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

interface CommentWidgetProps {
  comment: LineComment;
  onEdit: (content: string) => void;
  onDelete: () => void;
  theme: 'light' | 'dark';
}

export const CommentWidget: React.FC<CommentWidgetProps> = ({
  comment,
  onEdit,
  onDelete,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(comment.content);
  const editTextareaRef = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    if (!isEditing) return;

    const focusTextarea = () => {
      const textarea = editTextareaRef.current;
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
  }, [isEditing]);

  const handleSave = () => {
    if (editContent.trim()) {
      onEdit(editContent.trim());
      setIsEditing(false);
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
    }
  };

  const handleCancel = () => {
    setEditContent(comment.content);
    setIsEditing(false);
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSave();
    }
    if (e.key === 'Escape') {
      handleCancel();
    }
  };

  return (
    <Card className="flex h-[140px] w-full flex-col">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 px-3 py-2">
        <CardTitle className="text-sm font-semibold leading-none">
          {isEditing ? 'Edit comment' : 'Comment'}
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            (Line {comment.lineNumber}
            {!isEditing && (
              <>
                {' '}
                • <RelativeTime value={comment.updatedAt} />
              </>
            )}
            )
          </span>
        </CardTitle>
        <TooltipProvider delayDuration={400}>
          <div className="flex items-center gap-1.5">
            {isEditing ? (
              <>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={handleCancel}
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
                      onClick={handleSave}
                      disabled={!editContent.trim()}
                    >
                      <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-xs">
                    Save (⌘+Enter)
                  </TooltipContent>
                </Tooltip>
              </>
            ) : (
              <>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => setIsEditing(true)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-xs">
                    Edit
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      onClick={onDelete}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-xs">
                    Delete
                  </TooltipContent>
                </Tooltip>
              </>
            )}
          </div>
        </TooltipProvider>
      </CardHeader>

      <CardContent className="flex-1 overflow-hidden px-3 pb-3 pt-0">
        {!isEditing ? (
          <Textarea
            readOnly
            value={comment.content}
            className="h-full resize-none text-sm"
            onDoubleClick={() => setIsEditing(true)}
            tabIndex={-1}
            onMouseDown={(event) => event.preventDefault()}
            onFocus={(event) => event.currentTarget.blur()}
          />
        ) : (
          <Textarea
            ref={editTextareaRef}
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Update the note…"
            className="h-full resize-none text-sm"
          />
        )}
      </CardContent>

    </Card>
  );
};
