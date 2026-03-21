import React from 'react';
import { motion } from 'framer-motion';
import {
  Clock,
  Pause,
  Play,
  Trash2,
  Pencil,
  CheckCircle2,
  XCircle,
  Zap,
  Github,
  FolderGit2,
  GitBranch,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { Button } from '../ui/button';
import AgentLogo from '../AgentLogo';
import { agentConfig } from '../../lib/agentConfig';
import { useRunningAutomations, getPhaseLabel } from './useRunningAutomations';
import type { Automation } from '@shared/automations/types';
import type { Project } from '../../types/app';
import { formatScheduleLabel, formatRelativeTime } from './utils';
import type { Agent } from '../../types';

interface AutomationCardProps {
  automation: Automation;
  projects: Project[];
  onEdit: (automation: Automation) => void;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  onTriggerNow: (id: string) => void;
  onViewLogs: (automation: Automation) => void;
}

const AutomationCard: React.FC<AutomationCardProps> = ({
  automation,
  projects,
  onEdit,
  onToggle,
  onDelete,
  onTriggerNow,
  onViewLogs,
}) => {
  const agent = agentConfig[automation.agentId as Agent];
  const project = projects.find((p) => p.id === automation.projectId);
  const isActive = automation.status === 'active';
  const isPaused = automation.status === 'paused';
  const hasGithub = project?.githubInfo?.connected && project?.githubInfo?.repository;

  const { isRunning, getRunState } = useRunningAutomations();
  const running = isRunning(automation.id);
  const runState = getRunState(automation.id);
  const isError = runState?.phase === 'error';
  const isDone = runState?.phase === 'done';

  return (
    <motion.div
      whileTap={{ scale: 0.985 }}
      transition={{ duration: 0.1, ease: 'easeInOut' }}
      className={`group relative rounded-lg border bg-muted/20 p-4 transition-all hover:bg-muted/40 hover:shadow-md ${
        isPaused && !running ? 'opacity-50' : ''
      } ${running ? 'border-blue-500/40 shadow-[0_0_12px_-4px_rgba(59,130,246,0.25)]' : ''} ${
        isError ? 'border-red-500/40 shadow-[0_0_12px_-4px_rgba(239,68,68,0.25)]' : ''
      } ${isDone ? 'border-emerald-500/40' : ''}`}
    >
      {/* Running progress bar */}
      {running && (
        <div className="absolute inset-x-0 top-0 h-[2px] overflow-hidden rounded-t-lg">
          <motion.div
            className="h-full bg-blue-500/60"
            initial={{ x: '-100%' }}
            animate={{ x: '100%' }}
            transition={{ repeat: Infinity, duration: 1.5, ease: 'easeInOut' }}
            style={{ width: '40%' }}
          />
        </div>
      )}

      {/* Top row: Agent icon + name + status + actions */}
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          {/* Agent icon */}
          <div
            className={`flex h-10 w-10 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg ${
              running ? 'bg-blue-500/10' : 'bg-muted/50'
            }`}
          >
            {running ? (
              <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
            ) : agent?.logo ? (
              <AgentLogo
                logo={agent.logo}
                alt={agent.name}
                isSvg={agent.isSvg}
                invertInDark={agent.invertInDark}
                className="h-6 w-6"
              />
            ) : (
              <span className="text-xs font-semibold text-muted-foreground">
                {automation.agentId.slice(0, 2).toUpperCase()}
              </span>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="truncate text-sm font-semibold">{automation.name}</h3>
              {/* Status badge — swapped for running/error/done */}
              {running ? (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-medium leading-none text-blue-600 dark:text-blue-400">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-blue-500" />
                  </span>
                  running
                </span>
              ) : isError ? (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-red-500/10 px-1.5 py-0.5 text-[10px] font-medium leading-none text-red-600 dark:text-red-400">
                  <AlertCircle className="h-2.5 w-2.5" />
                  failed
                </span>
              ) : isDone ? (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium leading-none text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="h-2.5 w-2.5" />
                  started
                </span>
              ) : (
                <span
                  className={`inline-flex shrink-0 items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none ${
                    isActive
                      ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                      : isPaused
                        ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                        : 'bg-red-500/10 text-red-600 dark:text-red-400'
                  }`}
                >
                  {automation.status}
                </span>
              )}
            </div>

            {/* Running phase text OR project row */}
            {runState && (running || isError) ? (
              <p
                className={`mt-0.5 text-xs ${isError ? 'text-red-500' : 'text-blue-500 dark:text-blue-400'}`}
              >
                {isError && runState.error ? runState.error : getPhaseLabel(runState.phase)}
              </p>
            ) : (
              <div className="mt-0.5 flex items-center gap-1.5">
                {hasGithub ? (
                  <Github className="h-3 w-3 flex-shrink-0 text-muted-foreground/50" />
                ) : (
                  <FolderGit2 className="h-3 w-3 flex-shrink-0 text-muted-foreground/50" />
                )}
                <span className="truncate text-xs text-muted-foreground">
                  {hasGithub
                    ? project!.githubInfo!.repository
                    : (project?.name ?? automation.projectName ?? 'Unknown project')}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Action buttons — visible on hover, disabled while running */}
        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={(e) => {
              e.stopPropagation();
              onToggle(automation.id);
            }}
            aria-label={isActive ? 'Pause' : 'Resume'}
            className="h-7 w-7"
            disabled={running}
          >
            {isActive ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={(e) => {
              e.stopPropagation();
              onEdit(automation);
            }}
            aria-label="Edit"
            className="h-7 w-7"
            disabled={running}
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={(e) => {
              e.stopPropagation();
              onTriggerNow(automation.id);
            }}
            aria-label="Run now"
            className="h-7 w-7"
            disabled={running}
          >
            {running ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Zap className="h-3.5 w-3.5" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(automation.id);
            }}
            aria-label="Delete"
            className="h-7 w-7 text-destructive"
            disabled={running}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Prompt preview — hide while running to make room for status */}
      {!running && (
        <p className="mb-3 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
          {automation.prompt}
        </p>
      )}

      {/* Footer */}
      <div
        className={`flex items-center justify-between border-t border-border/50 pt-3 ${running ? 'mt-1' : ''}`}
      >
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3 opacity-60" />
            {formatScheduleLabel(automation.schedule)}
          </span>
          <span className="rounded bg-muted/60 px-1.5 py-0.5 text-[10px] font-medium">
            {agent?.name ?? automation.agentId}
          </span>
          {automation.useWorktree && (
            <span className="flex items-center gap-0.5 text-muted-foreground/50">
              <GitBranch className="h-2.5 w-2.5" />
            </span>
          )}
        </div>

        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
          {running && runState?.startedAt && <RunningTimer startedAt={runState.startedAt} />}
          {!running && automation.lastRunAt && (
            <span className="flex items-center gap-1">
              {automation.lastRunResult === 'success' ? (
                <CheckCircle2 className="h-3 w-3 text-emerald-500" />
              ) : automation.lastRunResult === 'failure' ? (
                <XCircle className="h-3 w-3 text-red-500" />
              ) : null}
              {formatRelativeTime(automation.lastRunAt)}
            </span>
          )}
          {!running && automation.nextRunAt && isActive && (
            <span className="text-muted-foreground/60">
              next {formatRelativeTime(automation.nextRunAt)}
            </span>
          )}
        </div>
      </div>

      {/* Run count link */}
      {automation.runCount > 0 && !running && (
        <button
          type="button"
          className="mt-2 text-[10px] text-muted-foreground/50 transition-colors hover:text-foreground/60"
          onClick={(e) => {
            e.stopPropagation();
            onViewLogs(automation);
          }}
        >
          {automation.runCount} run{automation.runCount !== 1 ? 's' : ''} total →
        </button>
      )}
    </motion.div>
  );
};

/** Small live timer showing elapsed seconds since the run started */
const RunningTimer: React.FC<{ startedAt: number }> = ({ startedAt }) => {
  const [elapsed, setElapsed] = React.useState(0);

  React.useEffect(() => {
    const update = () => setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  const display = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

  return (
    <span className="flex items-center gap-1 tabular-nums text-blue-500 dark:text-blue-400">
      <Clock className="h-3 w-3" />
      {display}
    </span>
  );
};

export default AutomationCard;
