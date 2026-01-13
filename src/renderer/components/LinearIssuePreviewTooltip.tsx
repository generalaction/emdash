import React from 'react';
import { motion } from 'motion/react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';
import { ExternalLink, User, Tag, Folder } from 'lucide-react';
import linearLogo from '../../assets/images/linear.png';
import type { LinearIssueSummary } from '../types/linear';

type Props = {
  issue: LinearIssueSummary | null;
  children: React.ReactElement;
  side?: 'top' | 'right' | 'bottom' | 'left';
};

const StatusPill = ({ state }: { state?: { name?: string | null; type?: string | null } | null }) => {
  if (!state?.name) return null;

  const getStatusColor = (type?: string | null) => {
    switch (type) {
      case 'completed':
      case 'done':
        return 'bg-emerald-100/70 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200';
      case 'canceled':
      case 'cancelled':
        return 'bg-rose-100/70 text-rose-800 dark:bg-rose-500/10 dark:text-rose-200';
      case 'started':
      case 'in-progress':
        return 'bg-blue-100/70 text-blue-800 dark:bg-blue-500/10 dark:text-blue-200';
      default:
        return 'bg-slate-100/70 text-slate-800 dark:bg-slate-500/10 dark:text-slate-200';
    }
  };

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-[11px] ${getStatusColor(state.type)}`}
    >
      {state.name}
    </span>
  );
};

export const LinearIssuePreviewTooltip: React.FC<Props> = ({ issue, children, side = 'top' }) => {
  if (!issue) return children;

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent
          side={side}
          align="start"
          className="border-0 bg-transparent p-0 shadow-none"
          style={{ zIndex: 10000 }}
          onPointerDownOutside={(e) => e.preventDefault()}
        >
          <motion.div
            initial={{ opacity: 0, y: 4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.98 }}
            transition={{ duration: 0.16, ease: 'easeOut' }}
            className="min-w-[260px] max-w-sm rounded-lg border border-border/70 bg-popover/95 p-3 shadow-xl backdrop-blur-sm"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <img src={linearLogo} alt="Linear" className="h-4 w-4 dark:invert" />
                <span className="tracking-wide">Linear Issue</span>
                <span className="font-semibold text-muted-foreground/80">{issue.identifier}</span>
              </div>
              {issue.url && (
                <a
                  href={issue.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (window.electronAPI?.openExternal && issue.url) {
                      e.preventDefault();
                      window.electronAPI.openExternal(issue.url);
                    }
                  }}
                >
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>

            <div className="mt-1 line-clamp-2 text-sm font-semibold text-foreground">
              {issue.title || `Issue ${issue.identifier}`}
            </div>

            {issue.description && (
              <div className="mt-1.5 line-clamp-2 text-xs text-muted-foreground">
                {issue.description}
              </div>
            )}

            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <StatusPill state={issue.state} />

              {issue.assignee?.name && (
                <span className="inline-flex items-center gap-1">
                  <User className="h-3 w-3" />
                  <span>{issue.assignee.name}</span>
                </span>
              )}

              {issue.project?.name && (
                <span className="inline-flex items-center gap-1">
                  <Folder className="h-3 w-3" />
                  <span>{issue.project.name}</span>
                </span>
              )}

              {issue.team?.name && (
                <span className="inline-flex items-center gap-1">
                  <Tag className="h-3 w-3" />
                  <span>{issue.team.name}</span>
                </span>
              )}
            </div>
          </motion.div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

export default LinearIssuePreviewTooltip;