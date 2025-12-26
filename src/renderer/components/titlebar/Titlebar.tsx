import React from 'react';
import { Command, KanbanSquare } from 'lucide-react';
import SidebarLeftToggleButton from './SidebarLeftToggleButton';
import SidebarRightToggleButton from './SidebarRightToggleButton';
import { Button } from '../ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip';
import OpenInMenu from './OpenInMenu';
import BrowserToggleButton from './BrowserToggleButton';
import { isMac } from '../../lib/platform';

interface TitlebarProps {
  currentPath?: string | null;
  defaultPreviewUrl?: string | null;
  taskId?: string | null;
  taskPath?: string | null;
  projectPath?: string | null;
  isTaskMultiAgent?: boolean;
  onToggleKanban?: () => void;
  isKanbanOpen?: boolean;
  kanbanAvailable?: boolean;
  platform?: string;
  isFullscreen?: boolean;
}

const Titlebar: React.FC<TitlebarProps> = ({
  currentPath,
  defaultPreviewUrl,
  taskId,
  taskPath,
  projectPath,
  isTaskMultiAgent,
  onToggleKanban,
  isKanbanOpen = false,
  kanbanAvailable = false,
  platform,
  isFullscreen = false,
}) => {
  // macOS has traffic lights on the left that need space (unless in fullscreen)
  const needsTrafficLightSpace = isMac(platform) && !isFullscreen;
  const leftPadding = needsTrafficLightSpace ? 'pl-20' : 'pl-2';

  return (
    <header className="fixed inset-x-0 top-0 z-[80] flex h-[var(--tb,36px)] items-center bg-gray-50 shadow-[inset_0_-1px_0_hsl(var(--border))] [-webkit-app-region:drag] dark:bg-gray-900">
      {/* Left side: Sidebar toggle buttons */}
      <div
        className={`pointer-events-auto flex items-center gap-1 ${leftPadding} [-webkit-app-region:no-drag]`}
      >
        <SidebarLeftToggleButton />
        <SidebarRightToggleButton />
      </div>

      {/* Right side: Other buttons */}
      <div className="pointer-events-auto ml-auto flex items-center gap-1 pr-2 [-webkit-app-region:no-drag]">
        {currentPath ? <OpenInMenu path={currentPath} align="right" /> : null}
        {kanbanAvailable ? (
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Toggle Kanban view"
                  onClick={async () => {
                    const newState = !isKanbanOpen;
                    void import('../../lib/telemetryClient').then(({ captureTelemetry }) => {
                      captureTelemetry('toolbar_kanban_toggled', {
                        state: newState ? 'open' : 'closed',
                      });
                    });
                    onToggleKanban?.();
                  }}
                  className="h-8 w-8 text-muted-foreground hover:bg-background/80"
                >
                  <KanbanSquare className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs font-medium">
                <div className="flex flex-col gap-1">
                  <span>Toggle Kanban view</span>
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <Command className="h-3 w-3" aria-hidden="true" />
                    <span>P</span>
                  </span>
                </div>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : null}
        {taskId && !isTaskMultiAgent ? (
          <BrowserToggleButton
            defaultUrl={defaultPreviewUrl || undefined}
            taskId={taskId}
            taskPath={taskPath}
            parentProjectPath={projectPath}
          />
        ) : null}
      </div>
    </header>
  );
};

export default Titlebar;
