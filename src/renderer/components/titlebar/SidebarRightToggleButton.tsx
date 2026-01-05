import React from 'react';
import { Button } from '../ui/button';
import { PanelRight } from 'lucide-react';
import { useRightSidebar } from '../ui/right-sidebar';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '../ui/tooltip';
import { ShortcutHint } from '../ui/shortcut-hint';

const SidebarRightToggleButton: React.FC = () => {
  const { toggle, collapsed } = useRightSidebar();

  const label = 'Toggle right sidebar';

  const handleClick = async () => {
    const nextCollapsed = !collapsed;
    const nextState = nextCollapsed ? 'closed' : 'open';
    void import('../../lib/telemetryClient').then(({ captureTelemetry }) => {
      captureTelemetry('toolbar_right_sidebar_clicked', { state: nextState });
    });
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
            <ShortcutHint settingsKey="toggleRightSidebar" />
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

export default SidebarRightToggleButton;
