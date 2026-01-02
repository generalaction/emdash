import React, { useRef, useState } from 'react';
import { Check, Pencil, Trash2, X } from 'lucide-react';
import { Button } from '../../ui/button';
import { RelativeTime } from '../../ui/relative-time';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../ui/tooltip';
import { Comment, useTextareaAutoFocus } from './CommentCard';
import type { LineComment } from '../../../types/electron-api';

interface CommentWidgetProps {
  comment: LineComment;
  onEdit: (content: string) => void;
  onDelete: () => void;
}

export const CommentWidget: React.FC<CommentWidgetProps> = ({ comment, onEdit, onDelete }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(comment.content);
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);

  useTextareaAutoFocus(editTextareaRef, isEditing);
  React.useEffect(() => {
    if (!isEditing) {
      setEditContent(comment.content);
    }
  }, [comment.content, isEditing]);

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
    <Comment.Root>
      <Comment.Header>
        <Comment.Title>
          {isEditing ? 'Edit comment' : 'Comment'}
          <Comment.Meta className="ml-2">
            (Line {comment.lineNumber}
            {!isEditing && (
              <>
                {' '}
                • <RelativeTime value={comment.updatedAt} />
              </>
            )}
            )
          </Comment.Meta>
        </Comment.Title>
        <TooltipProvider delayDuration={400}>
          <Comment.Actions>
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
          </Comment.Actions>
        </TooltipProvider>
      </Comment.Header>

      <Comment.Body>
        {!isEditing ? (
          <Comment.Textarea
            readOnly
            value={comment.content}
            onDoubleClick={() => setIsEditing(true)}
            tabIndex={-1}
            onMouseDown={(event) => event.preventDefault()}
            onFocus={(event) => event.currentTarget.blur()}
          />
        ) : (
          <Comment.Textarea
            ref={editTextareaRef}
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Update the note…"
          />
        )}
      </Comment.Body>
    </Comment.Root>
  );
};
