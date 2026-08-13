import { CloudOff, Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';
import type { ProjectHostAccessState } from '@core/features/projects/api/browser/stores/project-context';
import type { LocalProject, SshProject } from '@core/primitives/projects/api';
import { cn } from '@core/primitives/styling/browser/cn';

type ProjectAvailabilityBannerProps = {
  project: LocalProject | SshProject;
  state: ProjectHostAccessState;
  machineName?: string;
};

type BannerCopy = {
  title: string;
  detail: string;
  progress: boolean;
};

export function ProjectAvailabilityBanner({
  project,
  state,
  machineName,
}: ProjectAvailabilityBannerProps) {
  if (state.kind === 'ready') return null;

  const copy = availabilityCopy(project, state, machineName);
  const Icon = copy.progress ? Loader2 : CloudOff;

  return (
    <section
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className={cn(
        'flex shrink-0 items-center gap-3 rounded-lg border px-4 py-3',
        state.kind === 'offline'
          ? 'border-foreground-warning/30 bg-background-warning text-foreground'
          : 'border-border bg-background-1 text-foreground'
      )}
    >
      <Icon
        aria-hidden="true"
        className={cn(
          'size-4 shrink-0',
          copy.progress
            ? 'animate-spin text-foreground-muted motion-reduce:animate-none'
            : 'text-foreground-warning'
        )}
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{copy.title}</p>
        <p className="text-xs text-foreground-muted">{copy.detail}</p>
      </div>
    </section>
  );
}

export function ProjectAvailabilityFrame({
  children,
  project,
  state,
  machineName,
}: ProjectAvailabilityBannerProps & { children: ReactNode }) {
  if (state.kind === 'ready') return children;

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <div className="mx-auto w-full max-w-[1060px] shrink-0 px-8 pt-6">
        <ProjectAvailabilityBanner project={project} state={state} machineName={machineName} />
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}

function availabilityCopy(
  project: LocalProject | SshProject,
  state: Exclude<ProjectHostAccessState, { kind: 'ready' }>,
  machineName?: string
): BannerCopy {
  if (project.type === 'local') {
    if (state.kind === 'offline') {
      return {
        title: 'Local runtime is unavailable',
        detail: 'Project data remains available. Live features will resume when it is ready.',
        progress: false,
      };
    }
    if (state.kind === 'attaching') {
      return {
        title: 'Opening Project locally',
        detail: 'The local runtime is ready. Live Project features will be available shortly.',
        progress: true,
      };
    }
    return {
      title: 'Preparing local runtime',
      detail: 'The Project stays open while local services start.',
      progress: true,
    };
  }

  const machine = machineName?.trim() || 'Machine';
  if (state.kind === 'offline') {
    return {
      title: `${machine} is offline`,
      detail:
        'Project data remains available. Live features will resume when the Machine is ready.',
      progress: false,
    };
  }
  if (state.kind === 'attaching') {
    return {
      title: `Opening Project on ${machine}`,
      detail: 'The Machine is ready. Live Project features will be available shortly.',
      progress: true,
    };
  }
  if (state.phase === 'connecting') {
    return {
      title: `Connecting to ${machine}`,
      detail: 'The Project stays open while the SSH connection is established.',
      progress: true,
    };
  }
  return {
    title: `Preparing ${machine}`,
    detail: 'SSH is connected. The workspace server is starting.',
    progress: true,
  };
}
