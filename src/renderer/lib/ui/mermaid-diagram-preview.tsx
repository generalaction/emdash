import { Expand } from 'lucide-react';
import { Button } from '@renderer/lib/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { cn } from '@renderer/utils/utils';

interface MermaidDiagramPreviewProps {
  svg: string;
  compact?: boolean;
  onExpand: () => void;
}

export function MermaidDiagramPreview({ svg, compact, onExpand }: MermaidDiagramPreviewProps) {
  return (
    <div className="group relative overflow-x-auto rounded-md border border-border bg-background">
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="secondary"
              size="icon-xs"
              aria-label="Expand Mermaid diagram"
              className="absolute top-1 right-1 z-10 opacity-0 shadow-sm ring-1 ring-border/80 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
              onClick={onExpand}
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
        className={cn(
          'min-w-fit p-2 text-foreground [&_svg]:block [&_svg]:h-auto [&_svg]:max-w-full',
          compact && 'p-1.5'
        )}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    </div>
  );
}
