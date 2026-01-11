import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Command,
  MessageSquare,
  Settings as SettingsIcon,
  KanbanSquare,
  Code2,
} from 'lucide-react';
import { ShortcutHint } from '../ui/shortcut-hint';
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
  taskId?: string | null;
  taskPath?: string | null;
  projectPath?: string | null;
  isTaskMultiAgent?: boolean;
  onToggleKanban?: () => void;
  isKanbanOpen?: boolean;
  kanbanAvailable?: boolean;
  onToggleEditor?: () => void;
  showEditorButton?: boolean;
  isEditorOpen?: boolean;
}

const Titlebar: React.FC<TitlebarProps> = ({
  onToggleSettings,
  isSettingsOpen = false,
  currentPath,
  githubUser,
  defaultPreviewUrl,
  taskId,
  taskPath,
  projectPath,
  isTaskMultiAgent,
  onToggleKanban,
  isKanbanOpen = false,
  kanbanAvailable = false,
  onToggleEditor,
  showEditorButton = false,
  isEditorOpen = false,
}) => {
  const [isFeedbackOpen, setIsFeedbackOpen] = useState(false);
  const feedbackButtonRef = useRef<HTMLButtonElement | null>(null);

  const handleOpenFeedback = useCallback(async () => {
    void import('../../lib/telemetryClient').then(({ captureTelemetry }) => {
      captureTelemetry('toolbar_feedback_clicked');
    });
    setIsFeedbackOpen(true);
  }, []);

  const handleCloseFeedback = useCallback(() => {
    setIsFeedbackOpen(false);
    feedbackButtonRef.current?.blur();
  }, []);

  // Broadcast overlay state so the preview pane can hide while feedback is open
  useEffect(() => {
    try {
      const open = Boolean(isFeedbackOpen);
      window.dispatchEvent(new CustomEvent('emdash:overlay:changed', { detail: { open } }));
    } catch {}
  }, [isFeedbackOpen]);

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
      <header className="fixed inset-x-0 top-0 z-[80] flex h-[var(--tb,36px)] items-center justify-end bg-muted pr-2 shadow-[inset_0_-1px_0_hsl(var(--border))] [-webkit-app-region:drag] dark:bg-background">
        <div className="pointer-events-auto flex items-center gap-1 [-webkit-app-region:no-drag]">
          {currentPath ? <OpenInMenu path={currentPath} align="right" /> : null}
          {showEditorButton ? (
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={isEditorOpen ? 'Close Editor' : 'Open Editor'}
                    onClick={async () => {
                      void import('../../lib/telemetryClient').then(({ captureTelemetry }) => {
                        captureTelemetry('toolbar_editor_clicked', {
                          action: isEditorOpen ? 'close' : 'open',
                        });
                      });
                      onToggleEditor?.();
                    }}
                    className="h-8 w-8 text-muted-foreground hover:bg-background/80"
                  >
                    <Code2 className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs font-medium">
                  <span>{isEditorOpen ? 'Close Editor' : 'Open Editor'}</span>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : null}
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
                    <ShortcutHint settingsKey="toggleKanban" />
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
                <div className="flex flex-col gap-1">
                  <span>Open feedback</span>
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <Command className="h-3 w-3" aria-hidden="true" />
                    <span>⇧</span>
                    <span>F</span>
                  </span>
                </div>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <SidebarLeftToggleButton isDisabled={isEditorOpen} />
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
                  onClick={async () => {
                    void import('../../lib/telemetryClient').then(({ captureTelemetry }) => {
                      captureTelemetry('toolbar_settings_clicked');
                    });
                    onToggleSettings();
                  }}
                  className="h-8 w-8 text-muted-foreground hover:bg-background/80"
                >
                  <SettingsIcon className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs font-medium">
                <div className="flex flex-col gap-1">
                  <span>Open settings</span>
                  <ShortcutHint settingsKey="settings" />
                </div>
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
