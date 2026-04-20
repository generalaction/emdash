import { Activity } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useMemo } from 'react';
import type { ResourcePtyEntry } from '@shared/resource-monitor';
import { appState } from '@renderer/lib/stores/app-state';
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/lib/ui/popover';
import { Toggle } from '@renderer/lib/ui/toggle';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 MB';
  const mb = bytes / (1024 * 1024);
  if (mb < 1024) return `${mb.toFixed(0)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

type Group = {
  projectId: string;
  projectName: string;
  entries: Array<ResourcePtyEntry & { taskName?: string }>;
};

export const ResourceMonitor = observer(function ResourceMonitor() {
  const store = appState.resourceMonitor;
  const snapshot = store.snapshot;
  const cpuLabel = `${store.totalCpuPercent.toFixed(0)}%`;
  const memLabel = formatBytes(store.totalMemoryBytes);

  const { groups, unknown } = useMemo(() => buildGroups(snapshot?.entries ?? []), [snapshot]);

  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger>
          <PopoverTrigger
            render={
              <Toggle
                size="sm"
                variant="outline"
                aria-label="Resource monitor"
                className="mr-1 gap-1.5 px-2 text-xs font-medium tabular-nums"
              >
                <Activity className="size-3.5" />
                <span>{cpuLabel}</span>
                <span className="text-muted-foreground/70">·</span>
                <span>{memLabel}</span>
              </Toggle>
            }
          />
        </TooltipTrigger>
        <TooltipContent>
          Resource monitor · {store.entryCount} {store.entryCount === 1 ? 'agent' : 'agents'}
        </TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-96 gap-0 p-0">
        <div className="border-b border-foreground/10 px-3 py-2">
          <div className="flex items-center justify-between text-xs font-semibold">
            <span>Resource monitor</span>
            <span className="text-muted-foreground">
              {snapshot ? new Date(snapshot.timestamp).toLocaleTimeString() : '—'}
            </span>
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
            <Stat label="CPU" value={cpuLabel} />
            <Stat label="Memory" value={memLabel} />
            <Stat label="Agents" value={String(store.entryCount)} />
          </div>
          {snapshot ? (
            <div className="mt-1 text-[10px] text-muted-foreground">
              System: {snapshot.cpuCount} cores ·{' '}
              {formatBytes(snapshot.totalMemoryBytes - snapshot.freeMemoryBytes)} /{' '}
              {formatBytes(snapshot.totalMemoryBytes)}
            </div>
          ) : null}
        </div>
        <div className="max-h-80 overflow-y-auto py-1">
          {groups.length === 0 && unknown.length === 0 ? (
            <div className="px-3 py-4 text-center text-xs text-muted-foreground">
              No active agents
            </div>
          ) : (
            <>
              {groups.map((g) => (
                <ProjectSection
                  key={g.projectId}
                  title={g.projectName}
                  entries={g.entries}
                  store={store}
                />
              ))}
              {unknown.length > 0 ? (
                <ProjectSection title="Other" entries={unknown} store={store} />
              ) : null}
            </>
          )}
        </div>
        <div className="border-t border-foreground/10 px-3 py-1.5 text-[10px] text-muted-foreground">
          Samples every 1.5s · SSH processes not measurable locally
        </div>
      </PopoverContent>
    </Popover>
  );
});

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-muted-foreground">{label}</div>
      <div className="font-medium tabular-nums">{value}</div>
    </div>
  );
}

const ProjectSection = observer(function ProjectSection({
  title,
  entries,
  store,
}: {
  title: string;
  entries: Array<ResourcePtyEntry & { taskName?: string }>;
  store: typeof appState.resourceMonitor;
}) {
  return (
    <div className="px-2 py-1.5">
      <div className="px-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      <div className="mt-1 space-y-0.5">
        {entries.map((entry) => {
          const norm = store.normalizedCpu(entry);
          const label = entry.taskName ?? entry.scopeId;
          return (
            <div
              key={entry.sessionId}
              className="flex items-center justify-between gap-2 rounded px-1 py-0.5 text-xs hover:bg-muted"
              title={entry.sessionId}
            >
              <div className="min-w-0 flex-1 truncate">
                <span className="truncate">{label}</span>
                {entry.kind === 'ssh' ? (
                  <span className="ml-1 text-[10px] text-muted-foreground">(ssh)</span>
                ) : null}
              </div>
              <div className="flex items-center gap-2 tabular-nums text-muted-foreground">
                <span className="w-10 text-right">{norm.toFixed(0)}%</span>
                <span className="w-14 text-right">{formatBytes(entry.memory)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});

function buildGroups(entries: ResourcePtyEntry[]): { groups: Group[]; unknown: Group['entries'] } {
  const projects = appState.projects.projects;
  const byProject = new Map<string, Group>();
  const unknown: Group['entries'] = [];

  for (const entry of entries) {
    const projectStore = projects.get(entry.projectId);
    if (!projectStore) {
      unknown.push({ ...entry });
      continue;
    }
    const projectName = projectStore.name ?? projectStore.data?.name ?? entry.projectId.slice(0, 8);
    const bucket = byProject.get(entry.projectId) ?? {
      projectId: entry.projectId,
      projectName,
      entries: [],
    };
    let taskName: string | undefined;
    const mounted = projectStore.mountedProject;
    if (mounted) {
      const task = mounted.taskManager.tasks.get(entry.scopeId);
      if (task) taskName = task.displayName;
    }
    bucket.entries.push({ ...entry, taskName });
    byProject.set(entry.projectId, bucket);
  }

  for (const g of byProject.values()) {
    g.entries.sort((a, b) => b.cpu - a.cpu);
  }
  return { groups: Array.from(byProject.values()), unknown };
}
