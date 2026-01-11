import React from 'react';
import { Button } from '../ui/button';
import { PanelLeft } from 'lucide-react';
import { useSidebar } from '../ui/sidebar';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '../ui/tooltip';
import { ShortcutHint } from '../ui/shortcut-hint';

interface SidebarLeftToggleButtonProps {
  isDisabled?: boolean;
}

const SidebarLeftToggleButton: React.FC<SidebarLeftToggleButtonProps> = ({
  isDisabled = false,
}) => {
  const { toggle, open } = useSidebar();

  const handleClick = async () => {
    if (isDisabled) return;
    const newState = !open;
    void import('../../lib/telemetryClient').then(({ captureTelemetry }) => {
      captureTelemetry('toolbar_left_sidebar_clicked', { state: newState ? 'open' : 'closed' });
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
            disabled={isDisabled}
            className="h-8 w-8 text-muted-foreground [-webkit-app-region:no-drag] hover:bg-background/80 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Toggle left sidebar"
            aria-disabled={isDisabled}
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
            <span>{isDisabled ? 'Sidebar disabled in editor mode' : 'Toggle left sidebar'}</span>
            {!isDisabled && <ShortcutHint settingsKey="toggleLeftSidebar" />}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

export default SidebarLeftToggleButton;
