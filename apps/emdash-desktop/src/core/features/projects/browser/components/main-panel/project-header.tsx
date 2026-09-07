import { StatusIcon } from '@emdash/ui/react/components';
import { EntityHeader } from '@emdash/ui/react/patterns';
import { Button, DropdownMenu, Heading, Separator } from '@emdash/ui/react/primitives';
import {
  EllipsisIcon,
  ExternalLink,
  FolderInput,
  FolderOpen,
  GithubIcon,
  Globe,
  Pencil,
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
import { useOpenModal } from '@core/manifests/browser/modal-api';
import { openExternal } from '@core/primitives/desktop-host/browser/host-client';
import { isGitHubDotComHost, parseRepositoryRef } from '@core/primitives/repository/api';

export const ProjectHeader = observer(function ProjectHeader({ projectId }: { projectId: string }) {
  const store = getProjectStore(projectId);
  const project = store?.data;
  const displayName = projectDisplayName(store) ?? 'this project';
  const confirmDeleteProject = useConfirmDeleteProject();
  const openRename = useOpenModal('renameProjectModal');
  const repositoryStore = getGitRepositoryStore(projectId);
  const baseRemoteUrl = repositoryStore?.baseRemote?.url;
  const repository = parseRepositoryRef(repositoryStore?.canonicalRepositoryUrl);
  const isGithubUrl = repository ? isGitHubDotComHost(repository.host) : false;
  const repositoryUrl = isGithubUrl ? (repository?.repositoryUrl ?? baseRemoteUrl) : baseRemoteUrl;
  const repositoryLabel = repository?.nameWithOwner ?? baseRemoteUrl?.replace(/^https?:\/\//, '');

  if (!project) return null;

  const ProjectIcon = project.type === 'ssh' ? FolderInput : FolderOpen;

  return (
    <EntityHeader
      icon={
        <StatusIcon
          aria-hidden
          severity="neutral"
          size="lg"
          icon={<ProjectIcon aria-hidden size={20} />}
        />
      }
      title={
        <Heading level={1} tone="default" className="min-w-0 flex-1 truncate">
          {displayName}
        </Heading>
      }
      actions={
        <>
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
                onClick={() => {
                  void openRename({ projectId, currentName: displayName });
                }}
              >
                <Pencil />
                Rename Project
              </DropdownMenu.Item>
              <DropdownMenu.Separator />
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
        </>
      }
    />
  );
});
