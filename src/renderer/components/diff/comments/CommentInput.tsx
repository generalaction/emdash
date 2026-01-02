import React, { useRef, useState } from 'react';
import { Check, X } from 'lucide-react';
import { Button } from '../../ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../ui/tooltip';
import { Comment, useTextareaAutoFocus } from './CommentCard';

interface CommentInputProps {
  lineNumber: number;
  existingContent?: string;
  onSubmit: (content: string) => void;
  onCancel: () => void;
}

export const CommentInput: React.FC<CommentInputProps> = ({
  lineNumber,
  existingContent,
  onSubmit,
  onCancel,
}) => {
  const [content, setContent] = useState(existingContent || '');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useTextareaAutoFocus(textareaRef, true);

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
    <Comment.Root>
      <Comment.Header>
        <Comment.Title>
          {existingContent ? 'Edit comment' : 'Add comment'}
          <Comment.Meta className="ml-2">(Line {lineNumber})</Comment.Meta>
        </Comment.Title>
        <TooltipProvider delayDuration={400}>
          <Comment.Actions>
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
          </Comment.Actions>
        </TooltipProvider>
      </Comment.Header>

      <Comment.Body>
        <Comment.Textarea
          ref={textareaRef}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Add a note about this line…"
          autoFocus
        />
      </Comment.Body>
    </Comment.Root>
  );
};
