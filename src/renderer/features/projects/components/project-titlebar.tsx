import { ChevronDown, Ellipsis, ExternalLink, GithubIcon, Globe, Trash2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { parseGitHubRepository } from '@shared/github-repository';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@renderer/lib/ui/dropdown-menu';
import { Separator } from '@renderer/lib/ui/separator';

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
  const repositoryUrl = repo?.repositoryUrl;
  const repository = parseGitHubRepository(repositoryUrl);

  const isGithubUrl = Boolean(repository);
  const repoLabel = repository?.nameWithOwner ?? remoteUrl?.replace(/^https?:\/\//, '');

  return (
    <div className="flex items-center px-2 gap-2 h-full">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button className="flex items-center gap-1.5 text-foreground-muted text-sm hover:text-foreground group">
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
            <Trash2 className="size-4 " />
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
          <button
            className="flex items-center gap-1.5 text-foreground-muted text-sm hover:text-foreground group transition-colors"
            onClick={() => void rpc.app.openExternal(remoteUrl ?? '')}
          >
            <div className="text-sm flex items-center gap-1">
              {isGithubUrl ? <GithubIcon className="size-3.5" /> : <Globe className="size-3.5" />}
              <span className="truncate">{repoLabel}</span>
            </div>
            <ExternalLink className="size-3.5 shrink-0 opacity-0 group-hover:opacity-100 text-foreground-muted hover:text-foreground transition-opacity" />
          </button>
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
    <div className="flex items-center px-2 gap-2">
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
          <div className="flex items-center gap-2 mr-2">
            <OpenInMenu path={mounted.data.path} className="h-7 bg-background" />
          </div>
        ) : undefined
      }
    />
  );
});
