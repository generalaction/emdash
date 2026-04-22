import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  ArrowLeft,
  Command,
  MessageSquare,
  Settings as SettingsIcon,
  KanbanSquare,
  Code2,
  ArrowUpRight,
} from 'lucide-react';
import { ShortcutHint } from '../ui/shortcut-hint';
import SidebarLeftToggleButton from './SidebarLeftToggleButton';
import SidebarRightToggleButton from './SidebarRightToggleButton';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip';
import OpenInMenu from './OpenInMenu';
import FeedbackModal from '../FeedbackModal';
import BrowserToggleButton from './BrowserToggleButton';
import TitlebarContext from './TitlebarContext';
import WindowControls from './WindowControls';
import TitlebarMenu from './TitlebarMenu';
import PerformanceChip from './PerformanceChip';
import { useProjectManagementContext } from '../../contexts/ProjectManagementProvider';
import { useTaskManagementContext } from '../../contexts/TaskManagementContext';
import { useGithubContext } from '../../contexts/GithubContextProvider';
import { useAppSettings } from '@/contexts/AppSettingsProvider';
import { getEmdashV1BetaUrl } from '@shared/urls';

const isMacOS = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);

interface GithubUser {
  login?: string;
  name?: string;
  html_url?: string;
  email?: string;
}

interface TitlebarProps {
  onToggleSettings: () => void;
  isSettingsOpen?: boolean;
  onToggleKanban?: () => void;
  onToggleEditor?: () => void;
}

interface TitlebarToggleButtonProps {
  isOpen: boolean;
  openLabel: string;
  openIcon: LucideIcon;
  closedIcon: LucideIcon;
  ariaLabelOpen: string;
  ariaLabelClosed: string;
  onClick: () => void;
  tooltip: React.ReactNode;
}

function TitlebarToggleButton({
  isOpen,
  openLabel,
  openIcon: OpenIcon,
  closedIcon: ClosedIcon,
  ariaLabelOpen,
  ariaLabelClosed,
  onClick,
  tooltip,
}: TitlebarToggleButtonProps) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size={isOpen ? 'sm' : 'icon'}
            aria-label={isOpen ? ariaLabelOpen : ariaLabelClosed}
            onClick={onClick}
            className={`h-8 text-muted-foreground transition-colors hover:bg-transparent hover:text-foreground ${
              isOpen ? 'gap-1.5 px-2 text-xs font-medium' : 'w-8 text-muted-foreground'
            }`}
          >
            {isOpen ? (
              <>
                <OpenIcon className="h-3.5 w-3.5" />
                <span>{openLabel}</span>
              </>
            ) : (
              <ClosedIcon className="h-4 w-4" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs font-medium">
          {tooltip}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

const Titlebar: React.FC<TitlebarProps> = ({
  onToggleSettings,
  isSettingsOpen = false,
  onToggleKanban,
  onToggleEditor,
}) => {
  const {
    projects,
    selectedProject,
    handleSelectProject: onSelectProject,
    showKanban: isKanbanOpen,
    showEditorMode: isEditorOpen,
  } = useProjectManagementContext();
  const {
    activeTask,
    handleSelectTask: onSelectTask,
    tasksByProjectId,
  } = useTaskManagementContext();
  const { user: githubUser } = useGithubContext();
  const { settings } = useAppSettings();
  const showResourceMonitor = settings?.interface?.showResourceMonitor ?? false;

  const isTaskMultiAgent = Boolean(activeTask?.metadata?.multiAgent?.enabled);
  const currentPath = isTaskMultiAgent
    ? null
    : activeTask?.path ||
      (selectedProject?.isRemote ? selectedProject?.remotePath : selectedProject?.path) ||
      null;
  const taskId = activeTask?.id || null;
  const taskPath = activeTask?.path || null;
  const projectPath = selectedProject?.path || null;
  const kanbanAvailable = Boolean(selectedProject);
  const showEditorButton = Boolean(activeTask);
  const [isFeedbackOpen, setIsFeedbackOpen] = useState(false);
  const [isHeaderHovered, setIsHeaderHovered] = useState(false);
  const feedbackButtonRef = useRef<HTMLButtonElement | null>(null);
  const headerRef = useRef<HTMLElement | null>(null);
  const betaUrl = getEmdashV1BetaUrl('titlebar-badge');

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

  // Track mouse position to show/hide center content on header hover.
  // CSS :hover doesn't work on -webkit-app-region:drag elements in Electron.
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const headerEl = headerRef.current;
      if (!headerEl) return;
      const rect = headerEl.getBoundingClientRect();
      setIsHeaderHovered(e.clientY >= rect.top && e.clientY <= rect.bottom);
    };

    const handleMouseLeave = () => {
      setIsHeaderHovered(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.documentElement.addEventListener('mouseleave', handleMouseLeave);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.documentElement.removeEventListener('mouseleave', handleMouseLeave);
    };
  }, []);

  return (
    <>
      <header
        ref={headerRef}
        className="fixed inset-x-0 top-0 z-[80] flex h-[var(--tb,36px)] items-center bg-muted shadow-[inset_0_-1px_0_hsl(var(--border))] [-webkit-app-region:drag] dark:bg-background"
      >
        {/* Left: menu bar (Windows/Linux only) + performance chip */}
        {!isMacOS && (
          <div className="pointer-events-auto flex-shrink-0">
            <TitlebarMenu />
          </div>
        )}
        <div
          className="pointer-events-auto flex flex-shrink-0 items-center gap-2 [-webkit-app-region:no-drag]"
          style={{
            paddingLeft: isMacOS ? 'env(titlebar-area-x, 80px)' : '0.5rem',
          }}
        >
          <Badge
            asChild
            variant="outline"
            className="border-emerald-700/18 hover:border-emerald-600/28 h-7 rounded-md bg-gradient-to-r from-emerald-950 via-emerald-900 to-teal-900 px-2.5 text-[11px] font-semibold text-emerald-50 shadow-sm shadow-emerald-950/20 transition-colors hover:from-emerald-900 hover:via-emerald-800 hover:to-teal-800 hover:text-white dark:border-emerald-500/30 dark:from-emerald-950 dark:via-emerald-900 dark:to-teal-900 dark:text-emerald-50 dark:hover:border-emerald-400/40 dark:hover:from-emerald-900 dark:hover:via-emerald-800 dark:hover:to-teal-800"
          >
            <a
              href={betaUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(event) => {
                event.preventDefault();
                void window.electronAPI.openExternal(betaUrl);
              }}
            >
              Try v1 beta now
              <ArrowUpRight className="size-3.5" data-icon="inline-end" />
            </a>
          </Badge>
          {showResourceMonitor ? <PerformanceChip /> : null}
        </div>
        {/* Center: project/task context (grows to fill) */}
        <div
          className={`pointer-events-none flex min-w-0 flex-1 justify-center transition-opacity duration-200 has-[[data-state=open]]:opacity-100 ${isHeaderHovered ? 'opacity-100' : 'opacity-0'}`}
        >
          <div className="w-[min(60vw,720px)] truncate">
            <TitlebarContext
              projects={projects}
              selectedProject={selectedProject}
              tasks={selectedProject ? (tasksByProjectId[selectedProject.id] ?? []) : []}
              activeTask={activeTask}
              onSelectProject={onSelectProject}
              onSelectTask={onSelectTask}
            />
          </div>
        </div>
        {/* Right: action buttons */}
        <div className="pointer-events-auto flex flex-shrink-0 items-center gap-1 pr-2 [-webkit-app-region:no-drag]">
          {currentPath ? (
            <OpenInMenu
              path={currentPath}
              align="right"
              isRemote={selectedProject?.isRemote || false}
              sshConnectionId={selectedProject?.sshConnectionId || null}
            />
          ) : null}
          {showEditorButton ? (
            <TitlebarToggleButton
              isOpen={isEditorOpen}
              openLabel="Home"
              openIcon={ArrowLeft}
              closedIcon={Code2}
              ariaLabelOpen="Back to Home"
              ariaLabelClosed="Open Editor"
              onClick={() => {
                void import('../../lib/telemetryClient').then(({ captureTelemetry }) => {
                  captureTelemetry('toolbar_editor_clicked', {
                    action: isEditorOpen ? 'close' : 'open',
                  });
                });
                onToggleEditor?.();
              }}
              tooltip={
                <div className="flex flex-col gap-1">
                  <span>{isEditorOpen ? 'Home' : 'Open Editor'}</span>
                  <ShortcutHint settingsKey="toggleEditor" />
                </div>
              }
            />
          ) : null}
          {kanbanAvailable ? (
            <TitlebarToggleButton
              isOpen={isKanbanOpen}
              openLabel="Home"
              openIcon={ArrowLeft}
              closedIcon={KanbanSquare}
              ariaLabelOpen="Back to Home"
              ariaLabelClosed="Toggle Kanban view"
              onClick={() => {
                const newState = !isKanbanOpen;
                void import('../../lib/telemetryClient').then(({ captureTelemetry }) => {
                  captureTelemetry('toolbar_kanban_toggled', {
                    state: newState ? 'open' : 'closed',
                  });
                });
                onToggleKanban?.();
              }}
              tooltip={
                <div className="flex flex-col gap-1">
                  <span>{isKanbanOpen ? 'Home' : 'Toggle Kanban view'}</span>
                  <ShortcutHint settingsKey="toggleKanban" />
                </div>
              }
            />
          ) : null}
          {taskId && !isTaskMultiAgent ? (
            <BrowserToggleButton
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
                  className="h-8 w-8 text-muted-foreground transition-colors [-webkit-app-region:no-drag] hover:bg-transparent hover:text-foreground"
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
                  className="h-8 w-8 text-muted-foreground transition-colors hover:bg-transparent hover:text-foreground"
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
        {/* Right: window controls (Windows/Linux only) */}
        {!isMacOS && <WindowControls />}
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
