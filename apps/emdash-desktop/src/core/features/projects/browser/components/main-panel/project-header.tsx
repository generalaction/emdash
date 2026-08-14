import { Button, DropdownMenu, Heading, Separator } from '@emdash/ui/react/primitives';
import {
  EllipsisIcon,
  ExternalLink,
  FolderInput,
  FolderOpen,
  GithubIcon,
  Globe,
  Trash2,
} from 'lucide-react';
import { observer } from 'mobx-react-lite';
import {
  getProjectStore,
  projectDisplayName,
} from '@core/features/projects/api/browser/stores/project-selectors';
import { useConfirmDeleteProject } from '@core/features/projects/contributions/browser/use-confirm-delete-project';
import { OpenInMenu } from '@core/features/settings/contributions/browser/open-in-menu';
import { getGitRepositoryStore } from '@core/features/source-control/api/browser/stores/source-control-selectors';
import { openExternal } from '@core/primitives/desktop-host/browser/host-client';
import { isGitHubDotComHost, parseRepositoryRef } from '@core/primitives/repository/api';

export const ProjectHeader = observer(function ProjectHeader({ projectId }: { projectId: string }) {
  const store = getProjectStore(projectId);
  const project = store?.data;
  const displayName = projectDisplayName(store) ?? 'this project';
  const confirmDeleteProject = useConfirmDeleteProject();
  const repositoryStore = getGitRepositoryStore(projectId);
  const baseRemoteUrl = repositoryStore?.baseRemote?.url;
  const repository = parseRepositoryRef(repositoryStore?.canonicalRepositoryUrl);
  const isGithubUrl = repository ? isGitHubDotComHost(repository.host) : false;
  const repositoryUrl = isGithubUrl ? (repository?.repositoryUrl ?? baseRemoteUrl) : baseRemoteUrl;
  const repositoryLabel = repository?.nameWithOwner ?? baseRemoteUrl?.replace(/^https?:\/\//, '');

  if (!project) return null;

  const ProjectIcon = project.type === 'ssh' ? FolderInput : FolderOpen;

  return (
    <header className="flex min-w-0 items-center gap-3">
      <div className="flex min-w-0 items-center gap-2">
        <ProjectIcon aria-hidden="true" className="size-8 shrink-0 text-foreground-muted" />
        <Heading level={1} tone="default" className="truncate">
          {displayName}
        </Heading>
      </div>
      <div className="ml-auto flex min-w-0 shrink-0 items-center gap-2">
        {repositoryUrl && repositoryLabel ? (
          <>
            <Button
              type="button"
              variant="ghost"
              className="group flex max-w-64 items-center gap-1.5 text-sm text-foreground-muted transition-colors hover:text-foreground"
              onClick={() => void openExternal(repositoryUrl)}
            >
              {isGithubUrl ? (
                <GithubIcon aria-hidden="true" className="size-3.5" />
              ) : (
                <Globe aria-hidden="true" className="size-3.5" />
              )}
              <span className="truncate">{repositoryLabel}</span>
              <ExternalLink
                aria-hidden="true"
                className="size-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
              />
            </Button>
            <Separator orientation="vertical" className="h-4 self-center!" />
          </>
        ) : null}
        <OpenInMenu
          path={project.path}
          className="h-7 bg-background"
          isRemote={project.type === 'ssh'}
          sshConnectionId={project.type === 'ssh' ? project.connectionId : undefined}
        />
        <DropdownMenu.Root>
          <DropdownMenu.Trigger
            render={
              <Button
                type="button"
                variant="secondary"
                size="xs"
                icon
                aria-label="Project actions"
              />
            }
          >
            <EllipsisIcon />
          </DropdownMenu.Trigger>
          <DropdownMenu.Content align="end">
            <DropdownMenu.Item
              variant="destructive"
              onClick={() => {
                void confirmDeleteProject({ projectId, projectLabel: displayName });
              }}
            >
              <Trash2 />
              Remove Project
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      </div>
    </header>
  );
});
