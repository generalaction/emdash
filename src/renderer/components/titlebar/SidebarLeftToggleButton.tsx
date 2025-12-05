import React from 'react';
import { Button } from '../ui/button';
import { Command, PanelLeft } from 'lucide-react';
import { useSidebar } from '../ui/sidebar';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '../ui/tooltip';

const SidebarLeftToggleButton: React.FC = () => {
  const { toggle } = useSidebar();

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={toggle}
            className="h-8 w-8 text-muted-foreground [-webkit-app-region:no-drag] hover:bg-background/80"
            aria-label="Toggle left sidebar"
          >
            <PanelLeft className="h-4 w-4" />
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
            <span>Toggle left sidebar</span>
            <span className="flex items-center gap-1 text-muted-foreground">
              <Command className="h-3 w-3" aria-hidden="true" />
              <span>B</span>
            </span>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

export default SidebarLeftToggleButton;
