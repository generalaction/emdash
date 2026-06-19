import { Expand } from 'lucide-react';
import type React from 'react';
import { Button } from '@renderer/lib/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { cn } from '@renderer/utils/utils';

interface MermaidDiagramPreviewProps {
  svg: string;
  compact?: boolean;
  onExpand: () => void;
}

export function MermaidDiagramPreview({ svg, compact, onExpand }: MermaidDiagramPreviewProps) {
  const expandFromInteraction = (event: React.SyntheticEvent) => {
    event.preventDefault();
    event.stopPropagation();
    onExpand();
  };

  const handlePreviewKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      expandFromInteraction(event);
    }
  };

  return (
    <div className="group/mermaid relative overflow-x-auto rounded-md border border-border bg-background">
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="secondary"
              size="icon-xs"
              aria-label="Expand Mermaid diagram"
              className="absolute top-1 right-1 z-10 opacity-0 shadow-sm ring-1 ring-border/80 transition-opacity group-hover/mermaid:opacity-100 focus-visible:opacity-100"
              onClick={expandFromInteraction}
            >
              <Expand className="size-3" />
            </Button>
          }
        />
        <TooltipContent side="left" align="end">
          Expand diagram
        </TooltipContent>
      </Tooltip>
      <div
        role="button"
        tabIndex={0}
        aria-label="Expand Mermaid diagram preview"
        className={cn(
          'min-w-fit cursor-zoom-in p-2 text-foreground [&_svg]:block [&_svg]:h-auto [&_svg]:max-w-full',
          compact && 'p-1.5'
        )}
        onClick={expandFromInteraction}
        onKeyDown={handlePreviewKeyDown}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    </div>
  );
}
