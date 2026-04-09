import { PanelLeft } from 'lucide-react';
import React from 'react';
import { useWorkspaceLayoutContext } from '../../core/view/layout-provider';
import { Button } from '../ui/button';
import { ShortcutHint } from '../ui/shortcut-hint';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip';

interface SidebarLeftToggleButtonProps {
  isDisabled?: boolean;
}

const SidebarLeftToggleButton: React.FC<SidebarLeftToggleButtonProps> = ({
  isDisabled = false,
}) => {
  const { toggleLeft, isLeftOpen } = useWorkspaceLayoutContext();

  const handleClick = async () => {
    if (isDisabled) return;
    const newState = !isLeftOpen;
    void import('../../lib/telemetryClient').then(({ captureTelemetry }) => {
      captureTelemetry('sidebar_toggled', { side: 'left', state: newState ? 'open' : 'closed' });
    });
    toggleLeft();
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
            disabled={isDisabled}
            className="h-8 w-8 text-muted-foreground transition-colors [-webkit-app-region:no-drag] hover:bg-transparent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Toggle left sidebar"
            aria-disabled={isDisabled}
          >
            <PanelLeft className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="end" sideOffset={8} className="text-xs font-medium">
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
