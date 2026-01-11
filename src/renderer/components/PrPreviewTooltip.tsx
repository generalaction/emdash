import React from 'react';
import { motion } from 'motion/react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';
import githubLogo from '../../assets/images/github.png';
import type { PrStatus } from '../lib/prStatus';

type Props = {
  pr: PrStatus;
  children: React.ReactElement;
  side?: 'top' | 'right' | 'bottom' | 'left';
};

const Pill = ({
  color,
  children,
}: {
  color: 'green' | 'red' | 'blue';
  children: React.ReactNode;
}) => {
  const palette =
    color === 'green'
      ? 'bg-emerald-100/70 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200'
      : color === 'red'
        ? 'bg-rose-100/70 text-rose-800 dark:bg-rose-500/10 dark:text-rose-200'
        : 'bg-slate-100/70 text-slate-800 dark:bg-slate-500/10 dark:text-slate-200';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-[11px] ${palette}`}
    >
      {children}
    </span>
  );
};

export const PrPreviewTooltip: React.FC<Props> = ({ pr, children, side = 'top' }) => {
  if (!pr) return children;
  const num = (v: unknown): number | null => {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    const parsed = typeof v === 'string' ? Number.parseInt(v, 10) : NaN;
    return Number.isFinite(parsed) ? parsed : null;
  };
  const additions = num(pr.additions);
  const deletions = num(pr.deletions);
  const changed = num(pr.changedFiles);

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent
          side={side}
          align="start"
          className="border-0 bg-transparent p-0 shadow-none"
        >
          <motion.div
            initial={{ opacity: 0, y: 4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.98 }}
            transition={{ duration: 0.16, ease: 'easeOut' }}
            className="min-w-[260px] max-w-sm rounded-lg border border-border/70 bg-popover/95 p-3 shadow-xl backdrop-blur-sm"
          >
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <img src={githubLogo} alt="GitHub" className="h-4 w-4" />
              <span className="tracking-wide">Pull Request</span>
              <span className="font-semibold text-muted-foreground/80">#{pr.number}</span>
            </div>
            <div className="mt-1 line-clamp-2 text-sm font-semibold text-foreground">
              {pr.title || `PR #${pr.number}`}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {additions !== null ? <Pill color="green">+{additions} added</Pill> : null}
              {deletions !== null ? <Pill color="red">-{deletions} deleted</Pill> : null}
              {changed !== null ? <Pill color="blue">{changed} files</Pill> : null}
              {additions === null && deletions === null && changed === null ? (
                <span className="text-[11px] text-muted-foreground/80">Diff stats unavailable</span>
              ) : null}
            </div>
          </motion.div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

export default PrPreviewTooltip;
