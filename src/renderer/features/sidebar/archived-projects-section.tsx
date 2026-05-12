import { Archive, ChevronRight } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { sidebarStore } from '@renderer/lib/stores/app-state';
import { cn } from '@renderer/utils/utils';
import { SidebarProjectItem } from './project-item';

export const ArchivedProjectsSection = observer(function ArchivedProjectsSection() {
  if (!sidebarStore.hasArchivedProjects) return null;

  const archived = sidebarStore.archivedProjects;
  const expanded = sidebarStore.isArchivedExpanded;

  return (
    <div className="border-t border-border/50 px-3 pt-1 pb-2 shrink-0">
      <button
        type="button"
        onClick={() => sidebarStore.toggleArchivedExpanded()}
        className="flex h-7 w-full items-center gap-1 rounded-md px-1 text-xs font-medium text-foreground-tertiary-muted hover:text-foreground-muted"
      >
        <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', expanded && 'rotate-90')} />
        <Archive className="h-3.5 w-3.5" />
        <span className="flex-1 text-left">Archived</span>
        <span className="text-foreground-tertiary-muted">{archived.length}</span>
      </button>
      {expanded && (
        <div className="mt-1 max-h-48 overflow-y-auto">
          {archived.map((project) => {
            const projectId = project.data!.id;
            return <SidebarProjectItem key={projectId} projectId={projectId} />;
          })}
        </div>
      )}
    </div>
  );
});
