import { Activity, ArrowLeft, Check, Copy, Folder, GitBranch, Pause, Play } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ResourceAppProcess, ResourceSnapshot } from '@shared/resource-monitor';
import AgentLogo from '@renderer/lib/components/agent-logo';
import {
  appProcessLabel,
  buildGroups,
  formatReport,
  type Entry,
  type Group,
  type TaskBucket,
} from '@renderer/lib/components/titlebar/resource-monitor';
import { agentMeta } from '@renderer/lib/providers/meta';
import { appState } from '@renderer/lib/stores/app-state';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { formatBytes } from '@renderer/utils/formatBytes';
import { cn } from '@renderer/utils/utils';

export const ResourceMonitorView = observer(function ResourceMonitorView({
  onBack,
}: {
  onBack: () => void;
}) {
  const store = appState.resourceMonitor;
  const snapshot = store.snapshot;
  const memLabel = formatBytes(store.totalMemoryBytes);
  const cpuLabel = `${store.totalCpuPercent.toFixed(1)}%`;

  const groups = useMemo(() => buildGroups(snapshot?.entries ?? []), [snapshot]);
  const processes = useMemo(
    () => [...(snapshot?.appProcesses ?? [])].sort((a, b) => b.memory - a.memory),
    [snapshot]
  );

  const hasProjects = groups.length > 0;
  const hasProcesses = processes.length > 0;

  return (
    <>
      <div className="flex items-center gap-2 border-b border-foreground/10 px-2 py-2">
        <button
          onClick={onBack}
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-foreground/50 transition-colors hover:bg-background-2 hover:text-foreground"
          aria-label="Back to search"
        >
          <ArrowLeft size={14} />
        </button>
        <Activity size={13} className="shrink-0 text-foreground/50" />
        <span className="text-sm font-medium tracking-tight">Resource Monitor</span>
        <div className="ml-auto flex items-center gap-3 text-xs tabular-nums">
          <Stat label="CPU" value={cpuLabel} />
          <Stat label="Mem" value={memLabel} />
          <CopyReportButton snapshot={snapshot} groups={groups} />
        </div>
      </div>

      <div className="max-h-[24rem] min-h-[14rem] overflow-y-auto px-1.5 py-1.5">
        {hasProcesses && (
          <Section heading="Application">
            <div className="flex flex-col">
              {processes.map((p) => (
                <ProcessRow key={p.pid} process={p} />
              ))}
            </div>
          </Section>
        )}

        <Section heading="Active agents">
          {hasProjects ? (
            <div className="flex flex-col gap-1">
              {groups.map((g) => (
                <ProjectRow key={g.projectId} group={g} />
              ))}
            </div>
          ) : (
            <div className="rounded-md py-6 text-center text-xs text-foreground/40">
              No active agents
            </div>
          )}
        </Section>
      </div>
    </>
  );
});

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span>
      <span className="text-foreground/40">{label} </span>
      <span className="font-medium text-foreground">{value}</span>
    </span>
  );
}

function Section({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <div className="flex flex-col">
      <div className="px-2 pb-0.5 pt-2 text-[10px] font-medium uppercase tracking-wider text-foreground/40">
        {heading}
      </div>
      {children}
    </div>
  );
}

function ProcessRow({ process }: { process: ResourceAppProcess }) {
  const label = appProcessLabel(process.type, process.name);
  return (
    <div
      className="grid grid-cols-[1fr_3rem_4rem] items-center gap-2 rounded-md px-2 py-1 text-xs text-foreground-muted hover:bg-background-2"
      title={`pid ${process.pid}`}
    >
      <span className="truncate">{label}</span>
      <span className="text-right tabular-nums text-foreground/50">{process.cpu.toFixed(1)}%</span>
      <span className="text-right tabular-nums text-foreground/50">
        {formatBytes(process.memory)}
      </span>
    </div>
  );
}

const ProjectRow = observer(function ProjectRow({ group }: { group: Group }) {
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 rounded-md px-2 py-1">
        <Folder size={12} className="shrink-0 text-foreground/40" />
        <span className="flex-1 truncate text-xs font-medium text-foreground">
          {group.projectName}
        </span>
        <span className="text-[10px] tabular-nums text-foreground/40">{group.entryCount}</span>
      </div>
      <div className="ml-[14px] flex flex-col border-l border-foreground/10 pl-1.5">
        {group.tasks.map((task) => (
          <TaskRow key={task.scopeId} task={task} />
        ))}
      </div>
    </div>
  );
});

function TaskRow({ task }: { task: TaskBucket }) {
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-1.5 px-2 py-0.5">
        <GitBranch size={10} className="shrink-0 text-foreground/40" />
        <span className="flex-1 truncate text-[11px] text-foreground/60">{task.taskName}</span>
        <span className="text-[10px] tabular-nums text-foreground/40">{task.entries.length}</span>
      </div>
      <div className="ml-[10px] flex flex-col border-l border-foreground/10 pl-1.5">
        {task.entries.map((entry) => (
          <AgentRow key={entry.sessionId} entry={entry} />
        ))}
      </div>
    </div>
  );
}

function AgentRow({ entry }: { entry: Entry }) {
  const [pending, setPending] = useState(false);
  const norm = appState.resourceMonitor.normalizedCpu(entry);
  const meta = entry.providerId ? agentMeta[entry.providerId] : undefined;
  const label =
    entry.conversationTitle || meta?.label || entry.providerId || entry.leafId.slice(0, 8);
  const canPause = entry.pid !== undefined;

  const handleTogglePaused = useCallback(async () => {
    if (!canPause || pending) return;
    setPending(true);
    try {
      if (entry.paused) {
        await appState.resourceMonitor.resumeSession(entry.sessionId);
      } else {
        await appState.resourceMonitor.pauseSession(entry.sessionId);
      }
    } finally {
      setPending(false);
    }
  }, [canPause, entry.paused, entry.sessionId, pending]);

  return (
    <div
      className="group/agent flex items-center gap-2 rounded-md px-2 py-1 hover:bg-background-2"
      title={entry.sessionId}
    >
      {meta?.icon ? (
        <span className="flex size-4 shrink-0 items-center justify-center">
          <AgentLogo
            logo={meta.icon}
            alt={meta.label ?? meta.alt ?? ''}
            isSvg={meta.isSvg}
            invertInDark={meta.invertInDark}
            className="h-3.5 w-3.5"
          />
        </span>
      ) : (
        <span className="size-4 shrink-0" />
      )}
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <span
          className={cn(
            'truncate text-xs',
            entry.paused ? 'text-foreground/40' : 'text-foreground-muted'
          )}
        >
          {label}
        </span>
        {entry.pid === undefined ? <Badge>SSH</Badge> : null}
        {entry.paused ? <Badge>Paused</Badge> : null}
      </div>
      <span className="shrink-0 text-xs tabular-nums text-foreground/50">
        {norm.toFixed(0)}% · {formatBytes(entry.memory)}
      </span>
      <Tooltip>
        <TooltipTrigger>
          <button
            disabled={!canPause || pending}
            onClick={handleTogglePaused}
            className="flex size-6 shrink-0 items-center justify-center rounded-md text-foreground/40 transition-colors hover:bg-background-3 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
            aria-label={entry.paused ? 'Resume' : 'Pause'}
          >
            {entry.paused ? <Play size={11} /> : <Pause size={11} />}
          </button>
        </TooltipTrigger>
        <TooltipContent>
          {!canPause ? 'Remote process — cannot pause' : entry.paused ? 'Resume' : 'Pause'}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="shrink-0 rounded bg-background-2 px-1.5 py-px font-mono text-[9px] uppercase tracking-wider text-foreground/50">
      {children}
    </span>
  );
}

function CopyReportButton({
  snapshot,
  groups,
}: {
  snapshot: ResourceSnapshot | null;
  groups: Group[];
}) {
  const [copied, setCopied] = useState(false);
  const resetRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (resetRef.current !== null) window.clearTimeout(resetRef.current);
    };
  }, []);

  const handleCopy = useCallback(async () => {
    if (!snapshot || typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return;
    try {
      await navigator.clipboard.writeText(formatReport(snapshot, groups));
      setCopied(true);
      if (resetRef.current !== null) window.clearTimeout(resetRef.current);
      resetRef.current = window.setTimeout(() => {
        setCopied(false);
        resetRef.current = null;
      }, 1500);
    } catch {
      setCopied(false);
    }
  }, [snapshot, groups]);

  return (
    <Tooltip>
      <TooltipTrigger>
        <button
          disabled={!snapshot}
          onClick={handleCopy}
          className="flex size-6 shrink-0 items-center justify-center rounded-md text-foreground/50 transition-colors hover:bg-background-2 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
          aria-label="Copy report"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
        </button>
      </TooltipTrigger>
      <TooltipContent>{copied ? 'Copied' : 'Copy report'}</TooltipContent>
    </Tooltip>
  );
}
