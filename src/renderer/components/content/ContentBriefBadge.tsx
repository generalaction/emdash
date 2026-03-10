import { FileText } from 'lucide-react';
import { type ContentBrief, hasContentBrief, formatBriefSummary } from './ContentBriefFields';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface ContentBriefBadgeProps {
  brief: ContentBrief | undefined | null;
  className?: string;
}

/**
 * Small badge that shows content brief info on Kanban cards.
 * Shows a tooltip with full brief on hover.
 */
export function ContentBriefBadge({ brief, className }: ContentBriefBadgeProps) {
  if (!hasContentBrief(brief)) {
    return null;
  }

  const summary = formatBriefSummary(brief);

  return (
    <TooltipProvider>
      <Tooltip delayDuration={200}>
        <TooltipTrigger asChild>
          <div
            className={`inline-flex items-center gap-1 rounded bg-muted/60 px-1.5 py-0.5 text-[10px] text-muted-foreground ${className || ''}`}
          >
            <FileText className="h-3 w-3" />
            <span className="max-w-24 truncate">{summary || 'Content Brief'}</span>
          </div>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          <div className="space-y-1 text-xs">
            {brief?.topic && (
              <div>
                <span className="font-medium">Topic:</span> {brief.topic}
              </div>
            )}
            {brief?.audience && (
              <div>
                <span className="font-medium">Audience:</span> {brief.audience}
              </div>
            )}
            {brief?.keywords && (
              <div>
                <span className="font-medium">Keywords:</span> {brief.keywords}
              </div>
            )}
            {brief?.tone && (
              <div>
                <span className="font-medium">Tone:</span> {brief.tone}
              </div>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export default ContentBriefBadge;
