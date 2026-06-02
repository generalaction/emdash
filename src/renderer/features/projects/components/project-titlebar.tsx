import { ChevronDown, Ellipsis, ExternalLink, GithubIcon, Globe, Trash2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useConfirmDeleteProject } from '@renderer/features/projects/hooks/use-confirm-delete-project';
import {
  asMounted,
  getProjectStore,
  getRepositoryStore,
  projectDisplayName,
  projectViewKind,
} from '@renderer/features/projects/stores/project-selectors';
import { OpenInMenu } from '@renderer/lib/components/titlebar/open-in-menu';
import { Titlebar } from '@renderer/lib/components/titlebar/Titlebar';
import { rpc } from '@renderer/lib/ipc';
import { useNavigate, useParams } from '@renderer/lib/layout/navigation-provider';
import { Button } from '@renderer/lib/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@renderer/lib/ui/dropdown-menu';
import { Separator } from '@renderer/lib/ui/separator';
import { isGitHubDotComHost, parseRepositoryRef } from '@shared/repository-ref';

const MountedProjectTitlebarLeft = observer(function ProjectTitlebarLeft({
  projectId,
}: {
  projectId: string;
}) {
  const { navigate } = useNavigate();
  const store = getProjectStore(projectId);
  const displayName = projectDisplayName(store) ?? 'this project';
  const confirmDeleteProject = useConfirmDeleteProject();

  const repo = getRepositoryStore(projectId);
  const baseRemote = repo?.baseRemote;
  const remoteUrl = baseRemote?.url;
  const repositoryUrl = repo?.canonicalRepositoryUrl;
  const repository = parseRepositoryRef(repositoryUrl);

  const isGithubUrl = repository ? isGitHubDotComHost(repository.host) : false;
  const repoLabel = repository?.nameWithOwner ?? remoteUrl?.replace(/^https?:\/\//, '');

  return (
    <div className="flex h-full items-center gap-2 px-2">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button className="group flex items-center gap-1.5 text-sm text-foreground-muted hover:text-foreground">
              <span className="text-sm">{displayName}</span>
              <ChevronDown className="size-3.5" />
            </button>
          }
        >
          <Ellipsis className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="min-w-40">
          <DropdownMenuItem
            className="flex items-center gap-2 text-foreground-destructive"
            onClick={() => {
              void confirmDeleteProject({
                projectId,
                projectLabel: displayName,
                onDeleted: () => navigate('home'),
              });
            }}
          >
            <Trash2 className="size-4" />
            Remove Project
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {remoteUrl && (
        <>
          <Separator
            orientation="vertical"
            className="h-4 data-[orientation=vertical]:self-center"
          />
          <Button
            variant="ghost"
            className="group flex items-center gap-1.5 text-sm text-foreground-muted transition-colors hover:text-foreground"
            onClick={() =>
              void rpc.app.openExternal(
                isGithubUrl ? (repository?.repositoryUrl ?? remoteUrl ?? '') : (remoteUrl ?? '')
              )
            }
          >
            <div className="flex items-center gap-1 text-sm">
              {isGithubUrl ? <GithubIcon className="size-3.5" /> : <Globe className="size-3.5" />}
              <span className="truncate">{repoLabel}</span>
            </div>
            <ExternalLink className="size-3.5 shrink-0 text-foreground-muted opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground" />
          </Button>
        </>
      )}
    </div>
  );
});

const ProjectTitlebarLeft = observer(function ProjectTitlebarLeft({
  projectId,
}: {
  projectId: string;
}) {
  const store = getProjectStore(projectId);
  const displayName = projectDisplayName(store);
  return (
    <div className="flex items-center gap-2 px-2">
      <span className="text-sm text-foreground-muted">{displayName}</span>
    </div>
  );
});

export const ProjectTitlebar = observer(function ProjectTitlebar() {
  const {
    params: { projectId },
  } = useParams('project');
  const store = getProjectStore(projectId);
  const kind = projectViewKind(store);

  if (kind !== 'ready') {
    return <Titlebar leftSlot={<ProjectTitlebarLeft projectId={projectId} />} />;
  }

  const mounted = asMounted(store);
  if (!mounted) return <Titlebar leftSlot={<ProjectTitlebarLeft projectId={projectId} />} />;

  const isRemote = mounted.data.type === 'ssh';

  return (
    <Titlebar
      leftSlot={<MountedProjectTitlebarLeft projectId={projectId} />}
      rightSlot={
        !isRemote ? (
          <div className="mr-2 flex items-center gap-2">
            <OpenInMenu path={mounted.data.path} className="h-7 bg-background" />
          </div>
        ) : undefined
      }
    />
  );
});
