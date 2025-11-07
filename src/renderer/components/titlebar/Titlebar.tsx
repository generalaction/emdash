import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Command, MessageSquare, Settings as SettingsIcon } from 'lucide-react';
import SidebarLeftToggleButton from './SidebarLeftToggleButton';
import SidebarRightToggleButton from './SidebarRightToggleButton';
import { Button } from '../ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip';
import OpenInMenu from './OpenInMenu';
import FeedbackModal from '../FeedbackModal';
import BrowserToggleButton from './BrowserToggleButton';

interface GithubUser {
  login?: string;
  name?: string;
  html_url?: string;
  email?: string;
}

interface TitlebarProps {
  onToggleSettings: () => void;
  isSettingsOpen?: boolean;
  currentPath?: string | null;
  githubUser?: GithubUser | null;
  defaultPreviewUrl?: string | null;
  workspaceId?: string | null;
  workspacePath?: string | null;
  projectPath?: string | null;
  isWorkspaceMultiAgent?: boolean;
}

const Titlebar: React.FC<TitlebarProps> = ({
  onToggleSettings,
  isSettingsOpen = false,
  currentPath,
  githubUser,
  defaultPreviewUrl,
  workspaceId,
  workspacePath,
  projectPath,
  isWorkspaceMultiAgent,
}) => {
  const [isFeedbackOpen, setIsFeedbackOpen] = useState(false);
  const feedbackButtonRef = useRef<HTMLButtonElement | null>(null);

  const handleOpenFeedback = useCallback(() => {
    setIsFeedbackOpen(true);
  }, []);

  const handleCloseFeedback = useCallback(() => {
    setIsFeedbackOpen(false);
    feedbackButtonRef.current?.blur();
  }, []);

  useEffect(() => {
    const handleGlobalShortcut = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
        return;
      }

      const target = event.target as HTMLElement | null;
      if (target) {
        const tagName = target.tagName;
        const isEditable =
          target.getAttribute('contenteditable') === 'true' ||
          tagName === 'INPUT' ||
          tagName === 'TEXTAREA' ||
          tagName === 'SELECT';
        if (isEditable) {
          return;
        }
      }

      const isMeta = event.metaKey || event.ctrlKey;
      if (isMeta && event.shiftKey && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        handleOpenFeedback();
      }
    };

    window.addEventListener('keydown', handleGlobalShortcut);
    return () => {
      window.removeEventListener('keydown', handleGlobalShortcut);
    };
  }, [handleOpenFeedback]);

  return (
    <>
      <header className="fixed inset-x-0 top-0 z-[80] flex h-[var(--tb,36px)] items-center justify-end bg-gray-50 pr-2 shadow-[inset_0_-1px_0_hsl(var(--border))] [-webkit-app-region:drag] dark:bg-gray-900">
        <div className="pointer-events-auto flex items-center gap-1 [-webkit-app-region:no-drag]">
          {currentPath ? <OpenInMenu path={currentPath} align="right" /> : null}
          {workspaceId && !isWorkspaceMultiAgent ? (
            <BrowserToggleButton
              defaultUrl={defaultPreviewUrl || undefined}
              workspaceId={workspaceId}
              workspacePath={workspacePath}
              parentProjectPath={projectPath}
            />
          ) : null}
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Open feedback"
                  onClick={handleOpenFeedback}
                  ref={feedbackButtonRef}
                  className="h-8 w-8 text-muted-foreground [-webkit-app-region:no-drag] hover:bg-background/80"
                >
                  <MessageSquare className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs font-medium">
                <span className="flex items-center gap-1">
                  <Command className="h-3 w-3" aria-hidden="true" />
                  <span>⇧</span>
                  <span>F</span>
                </span>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <SidebarLeftToggleButton />
          <SidebarRightToggleButton />
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant={isSettingsOpen ? 'secondary' : 'ghost'}
                  size="icon"
                  aria-label="Open settings"
                  aria-pressed={isSettingsOpen}
                  onClick={onToggleSettings}
                  className="h-8 w-8 text-muted-foreground hover:bg-background/80"
                >
                  <SettingsIcon className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs font-medium">
                <span className="flex items-center gap-1">
                  <Command className="h-3 w-3" aria-hidden="true" />
                  <span>,</span>
                </span>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </header>
      <FeedbackModal
        isOpen={isFeedbackOpen}
        onClose={handleCloseFeedback}
        githubUser={githubUser}
      />
    </>
  );
};

export default Titlebar;
