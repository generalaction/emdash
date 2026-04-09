import { PanelRight } from 'lucide-react';
import React from 'react';
import { captureTelemetry } from '@renderer/lib/telemetryClient';
import { Button } from '../ui/button';
import { useRightSidebar } from '../ui/right-sidebar';
import { ShortcutHint } from '../ui/shortcut-hint';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip';

const SidebarRightToggleButton: React.FC = () => {
  const { toggle, collapsed } = useRightSidebar();

  const label = 'Toggle right sidebar';

  const handleClick = async () => {
    const nextCollapsed = !collapsed;
    const nextState = nextCollapsed ? 'closed' : 'open';
    captureTelemetry('sidebar_toggled', { side: 'right', state: nextState });

    toggle();
  };

  return (
    <TooltipProvider delay={200}>
      <Tooltip>
        <TooltipTrigger>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={handleClick}
            className="h-8 w-8 text-muted-foreground transition-colors [-webkit-app-region:no-drag] hover:bg-transparent hover:text-foreground"
            aria-label={label}
          >
            <PanelRight className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="end" sideOffset={8} className="text-xs font-medium">
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
