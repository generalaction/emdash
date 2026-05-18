import { Folder } from 'lucide-react';
import { useState } from 'react';
import type { Branch, Remote } from '@shared/git';
import type { Project } from '@shared/projects';
import { ProjectBranchSelector } from '@renderer/lib/components/project-branch-selector';
import {
  RemoteSelectContent,
  RemoteSelectItem,
} from '@renderer/lib/components/remote-select-content';
import { rpc } from '@renderer/lib/ipc';
import { Button } from '@renderer/lib/ui/button';
import { Field, FieldDescription, FieldTitle } from '@renderer/lib/ui/field';
import { Input } from '@renderer/lib/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@renderer/lib/ui/select';
import { Separator } from '@renderer/lib/ui/separator';
import { Switch } from '@renderer/lib/ui/switch';
import { cn } from '@renderer/utils/utils';
import type { FormState, FormUpdate } from '../project-settings-form-model';

const SAME_AS_BASE_REMOTE = '__same_as_base_remote__';

type BaseProjectSettingsSectionProps = {
  projectId: string;
  form: FormState;
  defaultWorktreeDirectory: string;
  projectType: Project['type'];
  remotes: Remote[];
  worktreeDirectoryError: string | null;
  update: FormUpdate;
};

export function BaseProjectSettingsSection({
  projectId,
  form,
  defaultWorktreeDirectory,
  projectType,
  remotes,
  worktreeDirectoryError,
  update,
}: BaseProjectSettingsSectionProps) {
  const baseRemoteValue = form.baseRemote || 'origin';
  const pushRemoteValue = form.pushRemote || SAME_AS_BASE_REMOTE;
  const selectedBaseRemote = remotes.find((remote) => remote.name === baseRemoteValue);
  const selectedPushRemote = remotes.find((remote) => remote.name === pushRemoteValue);
  const [isBrowsingWorktreeDirectory, setIsBrowsingWorktreeDirectory] = useState(false);

  const handleBrowseWorktreeDirectory = async () => {
    if (isBrowsingWorktreeDirectory) return;

    setIsBrowsingWorktreeDirectory(true);
    try {
      const result = await rpc.app.openSelectDirectoryDialog({
        title: 'Select worktree directory',
        message: 'Choose the directory where worktrees should be created.',
        defaultPath: form.worktreeDirectory || defaultWorktreeDirectory,
      });
      if (result) {
        update('worktreeDirectory', result);
      }
    } finally {
      setIsBrowsingWorktreeDirectory(false);
    }
  };

  return (
    <>
      <Field>
        <FieldTitle>Worktree directory</FieldTitle>
        <FieldDescription className="text-foreground-muted">
          Change where worktrees are created.
        </FieldDescription>
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Input
              aria-invalid={worktreeDirectoryError ? true : undefined}
              className={cn(worktreeDirectoryError ? 'pr-44' : undefined)}
              placeholder={defaultWorktreeDirectory}
              value={form.worktreeDirectory}
              onChange={(e) => update('worktreeDirectory', e.target.value)}
            />
            {worktreeDirectoryError ? (
              <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-red-500">
                {worktreeDirectoryError}
              </span>
            ) : null}
          </div>
          {projectType === 'local' ? (
            <Button
              type="button"
              variant="outline"
              disabled={isBrowsingWorktreeDirectory}
              onClick={handleBrowseWorktreeDirectory}
            >
              <Folder data-icon="inline-start" className="size-4" />
              Browse
            </Button>
          ) : null}
        </div>
      </Field>

      <Separator />

      <Field>
        <FieldTitle>Default branch</FieldTitle>
        <FieldDescription className="text-foreground-muted">
          The branch new tasks are created from by default.
        </FieldDescription>
        <ProjectBranchSelector
          projectId={projectId}
          value={form.defaultBranch ?? undefined}
          onValueChange={(branch: Branch) => update('defaultBranch', branch)}
        />
      </Field>

      <Separator />

      <Field>
        <FieldTitle>Base remote</FieldTitle>
        <FieldDescription className="text-foreground-muted">
          Used for fetching remote branches, choosing task base branches and targeting pull
          requests.
        </FieldDescription>
        <Select
          value={baseRemoteValue}
          onValueChange={(value) => update('baseRemote', value ?? '')}
        >
          <SelectTrigger className="w-full min-w-0">
            <div className="flex min-w-0 flex-1 items-center gap-2 text-left">
              <span className="min-w-0 truncate">
                {selectedBaseRemote?.name ?? baseRemoteValue}
              </span>
            </div>
          </SelectTrigger>
          <RemoteSelectContent remotes={remotes} />
        </Select>
      </Field>

      <Separator />

      <Field>
        <FieldTitle>Push remote</FieldTitle>
        <FieldDescription className="text-foreground-muted">
          Used when publishing task branches and pushing commits.
        </FieldDescription>
        <Select
          value={pushRemoteValue}
          onValueChange={(value) =>
            update('pushRemote', value === SAME_AS_BASE_REMOTE ? '' : (value ?? ''))
          }
        >
          <SelectTrigger className="w-full min-w-0">
            <div className="flex min-w-0 flex-1 items-center gap-2 text-left">
              <span className="min-w-0 truncate">
                {pushRemoteValue === SAME_AS_BASE_REMOTE
                  ? 'Same as base remote'
                  : (selectedPushRemote?.name ?? pushRemoteValue)}
              </span>
            </div>
          </SelectTrigger>
          <SelectContent align="start" alignItemWithTrigger={false} sideOffset={6}>
            <SelectItem value={SAME_AS_BASE_REMOTE} className="py-2">
              <span className="relative -top-px shrink-0 font-medium">Same as base remote</span>
            </SelectItem>
            {remotes.map((remote) => (
              <RemoteSelectItem key={remote.name} remote={remote} />
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Separator />

      <Field orientation="horizontal">
        <div className="flex flex-1 flex-col gap-1">
          <FieldTitle>Enable tmux</FieldTitle>
          <FieldDescription className="text-foreground-muted">
            Run the agent session inside a tmux session.
          </FieldDescription>
        </div>
        <Switch checked={form.tmux} onCheckedChange={(checked) => update('tmux', checked)} />
      </Field>
    </>
  );
}
