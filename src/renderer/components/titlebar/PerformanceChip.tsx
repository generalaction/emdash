import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Cpu, RotateCw } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import AgentLogo from '@/components/AgentLogo';
import { agentAssets } from '@/providers/assets';
import { agentMeta, type UiAgent } from '@/providers/meta';
import type {
  AppMetrics,
  ProjectMetrics,
  ResourceMetricsSnapshot,
  SessionMetrics,
  TaskMetrics,
  UsageValues,
} from '../../../shared/performanceTypes';

// ── Formatters ───────────────────────────────────────────────────────

function fmtMem(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function fmtCpu(percent: number): string {
  return `${percent.toFixed(1)}%`;
}

function fmtPct(value: number): string {
  return `${value.toFixed(0)}%`;
}

// ── Layout constants ─────────────────────────────────────────────────

const COL = 'flex shrink-0 items-center tabular-nums';
const CPU_W = 'w-12 justify-end';
const MEM_W = 'w-[4.5rem] justify-end';

// ── MetricBadge (header cards) ───────────────────────────────────────

function MetricBadge({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-muted/60 px-2.5 py-1.5">
      <span className="block text-[10px] uppercase tracking-wider text-muted-foreground/70">
        {label}
      </span>
      <span className="block text-[15px] font-semibold tabular-nums leading-5 text-foreground">
        {value}
      </span>
    </div>
  );
}

// ── Row building blocks ──────────────────────────────────────────────

function ExpandToggle({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className="shrink-0 rounded p-0.5 text-muted-foreground outline-none hover:bg-black/5 dark:hover:bg-white/5"
    >
      {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
    </button>
  );
}

function ValueCells({ values, className }: { values: UsageValues; className?: string }) {
  return (
    <div className={cn(COL, 'gap-1 text-muted-foreground', className)}>
      <span className={CPU_W}>{fmtCpu(values.cpu)}</span>
      <span className={MEM_W}>{fmtMem(values.memory)}</span>
    </div>
  );
}

// ── App section ──────────────────────────────────────────────────────

function AppResourceSection({ app }: { app: AppMetrics }) {
  return (
    <div className="border-b border-border/50">
      {/* App total */}
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-xs font-medium text-foreground">Emdash App</span>
        <ValueCells values={app} className="text-xs" />
      </div>
      {/* Sub-rows */}
      <SubProcessRow label="Main" values={app.main} />
      <SubProcessRow label="Renderer" values={app.renderer} />
      {(app.other.cpu > 0 || app.other.memory > 0) && (
        <SubProcessRow label="Other" values={app.other} />
      )}
    </div>
  );
}

function SubProcessRow({ label, values }: { label: string; values: UsageValues }) {
  return (
    <div className="flex items-center justify-between py-1 pl-7 pr-3">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <ValueCells values={values} className="text-[11px]" />
    </div>
  );
}

// ── Session row (agent) with icon ────────────────────────────────────

function SessionRow({ session }: { session: SessionMetrics }) {
  const asset = agentAssets[session.providerId as UiAgent];
  const meta = agentMeta[session.providerId as UiAgent];
  const label = meta?.label ?? session.providerName;

  return (
    <div className="flex items-center justify-between py-1 pl-10 pr-3">
      <div className="flex min-w-0 items-center gap-1.5">
        {asset ? (
          <AgentLogo
            logo={asset.logo}
            alt={asset.alt}
            isSvg={asset.isSvg}
            invertInDark={asset.invertInDark}
            className="h-3.5 w-3.5 shrink-0 rounded-sm"
          />
        ) : null}
        <span className="truncate text-[11px] text-muted-foreground">{label}</span>
      </div>
      <ValueCells values={session} className="text-[11px]" />
    </div>
  );
}

// ── Task section ─────────────────────────────────────────────────────

function TaskSection({ task }: { task: TaskMetrics }) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div>
      <div className="flex items-center justify-between py-1.5 pl-5 pr-3">
        <div className="flex min-w-0 items-center gap-1">
          {task.sessions.length > 0 && (
            <ExpandToggle expanded={expanded} onToggle={() => setExpanded((v) => !v)} />
          )}
          <span className="truncate text-xs font-medium text-foreground/80">{task.taskName}</span>
        </div>
        <ValueCells values={task} className="text-xs" />
      </div>
      {expanded && task.sessions.map((s) => <SessionRow key={s.ptyId} session={s} />)}
    </div>
  );
}

// ── Project section ──────────────────────────────────────────────────

function ProjectSection({ project }: { project: ProjectMetrics }) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="border-b border-border/50 last:border-b-0">
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex min-w-0 items-center gap-1">
          {project.tasks.length > 0 && (
            <ExpandToggle expanded={expanded} onToggle={() => setExpanded((v) => !v)} />
          )}
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {project.projectName}
          </span>
        </div>
        <ValueCells values={project} className="text-xs" />
      </div>
      {expanded && project.tasks.map((t) => <TaskSection key={t.taskId} task={t} />)}
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────

const PerformanceChip: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<ResourceMetricsSnapshot | null>(null);
  const [isFetching, setIsFetching] = useState(false);
  const unsubRef = useRef<(() => void) | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchSnapshot = useCallback(async (mode: 'interactive' | 'idle' = 'idle') => {
    setIsFetching(true);
    try {
      const res = await window.electronAPI.perfGetSnapshot(mode);
      if (res.success && res.data) setSnapshot(res.data);
    } finally {
      setIsFetching(false);
    }
  }, []);

  // Push updates when popover is open — ~1 s live refresh
  useEffect(() => {
    if (!open) return;

    window.electronAPI
      .perfSubscribe()
      .then((res) => {
        if (res.success && res.data) setSnapshot(res.data);
      })
      .catch(() => {
        // IPC call failed (e.g., main process busy) — silently ignore,
        // the idle poll will pick up data on the next cycle.
      });
    unsubRef.current = window.electronAPI.onPerfSnapshot((s) => setSnapshot(s));

    return () => {
      unsubRef.current?.();
      unsubRef.current = null;
      window.electronAPI.perfUnsubscribe();
    };
  }, [open]);

  // Idle polling when popover closed — stable interval, skips fetches while open
  const openRef = useRef(open);
  openRef.current = open;

  useEffect(() => {
    fetchSnapshot('idle');
    pollRef.current = setInterval(() => {
      if (!openRef.current) fetchSnapshot('idle');
    }, 15_000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stable interval, reads open via ref
  }, [fetchSnapshot]);

  const ramShare =
    snapshot && snapshot.host.totalMemory > 0
      ? (snapshot.totalMemory / snapshot.host.totalMemory) * 100
      : 0;

  return (
    <TooltipProvider delayDuration={150}>
      <Popover open={open} onOpenChange={setOpen}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="flex h-6 items-center gap-1.5 rounded-md border border-border/60 bg-secondary/50 px-1.5 text-muted-foreground transition-all duration-150 ease-out [-webkit-app-region:no-drag] hover:border-border hover:bg-secondary focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                aria-label="Resource consumption"
              >
                <Cpu className="h-3 w-3 shrink-0" />
                {snapshot && (
                  <span className="text-[11px] font-medium tabular-nums">
                    {fmtMem(snapshot.totalMemory)}
                  </span>
                )}
              </button>
            </PopoverTrigger>
          </TooltipTrigger>
          {snapshot && !open && (
            <TooltipContent side="bottom" sideOffset={6}>
              CPU {fmtCpu(snapshot.totalCpu)} · {fmtMem(snapshot.totalMemory)}
            </TooltipContent>
          )}
        </Tooltip>

        <PopoverContent align="start" className="w-[26rem] overflow-hidden p-0">
          <div className="flex max-h-[min(70vh,520px)] flex-col overflow-hidden">
            {/* Header — pinned */}
            <div className="shrink-0 border-b border-border p-3">
              <div className="flex items-center justify-between">
                <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                  Resource Usage
                </h4>
                <button
                  type="button"
                  onClick={() => fetchSnapshot('interactive')}
                  className="rounded p-0.5 text-muted-foreground outline-none transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                  aria-label="Refresh metrics"
                >
                  <RotateCw className={cn('h-3.5 w-3.5', isFetching && 'animate-spin')} />
                </button>
              </div>

              {snapshot && (
                <div className="mt-2 grid grid-cols-3 gap-2">
                  <MetricBadge label="CPU" value={fmtCpu(snapshot.totalCpu)} />
                  <MetricBadge label="Memory" value={fmtMem(snapshot.totalMemory)} />
                  <MetricBadge label="RAM Share" value={fmtPct(ramShare)} />
                </div>
              )}
            </div>

            {/* Body — scrollable */}
            <div className="min-h-0 flex-1 overflow-y-auto">
              {snapshot && <AppResourceSection app={snapshot.app} />}

              {snapshot?.projects.map((project) => (
                <ProjectSection key={project.projectId} project={project} />
              ))}

              {snapshot && snapshot.projects.length === 0 && (
                <div className="px-3 py-4 text-center text-[11px] text-muted-foreground">
                  No active agent sessions
                </div>
              )}

              {!snapshot && (
                <div className="px-3 py-4 text-center text-[11px] text-muted-foreground">
                  Loading…
                </div>
              )}
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </TooltipProvider>
  );
};

export default PerformanceChip;
