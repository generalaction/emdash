import React from 'react';
import { ExternalLink, Square } from 'lucide-react';
import { Button } from './ui/button';
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
} from './ui/sidebar';
import dockerLogo from '../../assets/images/docker.png';
import {
  subscribeToAllRunStates,
  getAllRunStates,
  type ContainerRunState,
} from '@/lib/containerRuns';

interface Props {
  projects: any[];
  onSelectProject?: (project: any) => void;
  onSelectTask?: (task: any) => void;
}

const ActiveRuns: React.FC<Props> = ({ projects, onSelectProject, onSelectTask }) => {
  const [activeRuns, setActiveRuns] = React.useState<ContainerRunState[]>(() =>
    (getAllRunStates() || []).filter((s) => ['building', 'starting', 'ready'].includes(s.status))
  );

  React.useEffect(() => {
    const off = subscribeToAllRunStates((states) => {
      const active = states.filter((s) => ['building', 'starting', 'ready'].includes(s.status));
      setActiveRuns(active);
    });
    return () => off?.();
  }, []);

  if (!activeRuns.length) return null;

  // Resolve task/project mapping for display and navigation
  const byId = new Map<string, { project: any | null; task: any | null }>();
  for (const s of activeRuns) {
    let match: { project: any | null; task: any | null } | null = null;
    for (const proj of projects) {
      const ws = (proj.tasks || []).find((w: any) => w.id === s.taskId) || null;
      if (ws) {
        match = { project: proj, task: ws };
        break;
      }
    }
    byId.set(s.taskId, match ?? { project: null, task: null });
  }

  return (
    <SidebarGroup>
      <SidebarGroupLabel>
        <div className="flex items-center gap-2">
          <img src={dockerLogo} alt="" className="h-3.5 w-3.5" />
          <span className="font-medium">Active Runs</span>
          <span className="ml-1 rounded bg-muted px-1.5 py-0.5 text-micro text-muted-foreground">
            {activeRuns.length}
          </span>
        </div>
      </SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {activeRuns.map((s) => {
            const info = byId.get(s.taskId);
            const project = info?.project || null;
            const ws = info?.task || null;
            const name = ws?.name || s.taskId;
            const previewUrl = s.previewUrl;
            const onOpen = () => {
              if (project && ws) {
                onSelectProject?.(project);
                onSelectTask?.(ws);
              }
            };
            return (
              <SidebarMenuItem key={`${s.taskId}-${s.runId || 'run'}`}>
                <div className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-black/5 dark:hover:bg-white/5">
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpen();
                    }}
                  >
                    <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden="true" />
                    <span className="truncate text-sm font-medium">{name}</span>
                  </button>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {previewUrl ? (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="text-muted-foreground"
                        title="Open preview"
                        aria-label="Open preview"
                        onClick={(e) => {
                          e.stopPropagation();
                          window.electronAPI.openExternal(previewUrl);
                        }}
                      >
                        <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                      </Button>
                    ) : null}
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="text-muted-foreground hover:text-destructive"
                      title="Stop stack"
                      aria-label="Stop stack"
                      onClick={async (e) => {
                        e.stopPropagation();
                        try {
                          await (window as any).electronAPI.stopContainerRun?.(s.taskId);
                        } catch {}
                      }}
                    >
                      <Square className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                  </div>
                </div>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
};

export default ActiveRuns;
