import { Button } from '@emdash/ui/react/primitives';
import { Sparkles, X } from 'lucide-react';
import type { AiAnnotation } from '@core/features/source-control/api/browser/diff-view/stores/ai-annotations-store';
import { Comment } from './comment-card';

interface AiAnnotationWidgetProps {
  annotation: AiAnnotation;
  lineNumber: number;
  onDismiss: () => void;
}

export const AiAnnotationWidget: React.FC<AiAnnotationWidgetProps> = ({
  annotation,
  lineNumber,
  onDismiss,
}) => (
  <Comment.Root>
    <Comment.Header>
      <Comment.Title className="flex items-center gap-1.5">
        <Sparkles className="h-3.5 w-3.5" aria-hidden />
        AI explanation
        <Comment.Meta className="ml-1">(Line {lineNumber})</Comment.Meta>
      </Comment.Title>
      <Comment.Actions>
        <Button
          variant="ghost"
          size="xs"
          icon
          className="h-8 w-8"
          onClick={onDismiss}
          title="Dismiss"
          aria-label="Dismiss AI explanation"
        >
          <X className="h-4 w-4" />
        </Button>
      </Comment.Actions>
    </Comment.Header>
    <Comment.Body>
      {/* Agent text is untrusted; a read-only textarea renders it as plain text. */}
      <Comment.Textarea readOnly value={annotation.body} tabIndex={-1} />
    </Comment.Body>
  </Comment.Root>
);
