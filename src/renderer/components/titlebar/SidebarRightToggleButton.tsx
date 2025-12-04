import React from 'react';
import { Button } from '../ui/button';
import { Command, PanelRight } from 'lucide-react';
import { useRightSidebar } from '../ui/right-sidebar';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '../ui/tooltip';

const SidebarRightToggleButton: React.FC = () => {
  const { toggle } = useRightSidebar();

  const label = 'Toggle right sidebar';

  const handleClick = () => {
    toggle();
  };

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={handleClick}
            className="h-8 w-8 text-muted-foreground [-webkit-app-region:no-drag] hover:bg-background/80"
            aria-label={label}
          >
            <PanelRight className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent
          side="bottom"
          align="end"
          sideOffset={8}
          collisionPadding={8}
          className="text-xs font-medium"
        >
          <div className="flex flex-col gap-1">
            <span>Toggle right sidebar</span>
            <span className="flex items-center gap-1 text-muted-foreground">
              <Command className="h-3 w-3" aria-hidden="true" />
              <span>.</span>
            </span>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

export default SidebarRightToggleButton;
