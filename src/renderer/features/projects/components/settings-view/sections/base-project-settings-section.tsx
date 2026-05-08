import type { Branch, Remote } from '@shared/git';
import { ProjectBranchSelector } from '@renderer/lib/components/project-branch-selector';
import { Field, FieldDescription, FieldTitle } from '@renderer/lib/ui/field';
import { Input } from '@renderer/lib/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@renderer/lib/ui/select';
import { Separator } from '@renderer/lib/ui/separator';
import { Switch } from '@renderer/lib/ui/switch';
import { cn } from '@renderer/utils/utils';
import type { FormState, FormUpdate } from '../project-settings-form-model';

type BaseProjectSettingsSectionProps = {
  projectId: string;
  form: FormState;
  remotes: Remote[];
  worktreeDirectoryError: string | null;
  update: FormUpdate;
};

export function BaseProjectSettingsSection({
  projectId,
  form,
  remotes,
  worktreeDirectoryError,
  update,
}: BaseProjectSettingsSectionProps) {
  const remoteValue = form.remote || 'origin';
  const selectedRemote = remotes.find((remote) => remote.name === remoteValue);

  return (
    <>
      <Field>
        <FieldTitle>Worktree directory</FieldTitle>
        <FieldDescription className="text-foreground-muted">
          Change where worktrees are created.
        </FieldDescription>
        <div className="relative">
          <Input
            aria-invalid={worktreeDirectoryError ? true : undefined}
            className={cn(worktreeDirectoryError ? 'pr-44' : undefined)}
            placeholder="Leave blank to use the default"
            value={form.worktreeDirectory}
            onChange={(e) => update('worktreeDirectory', e.target.value)}
          />
          {worktreeDirectoryError ? (
            <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-red-500">
              {worktreeDirectoryError}
            </span>
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
        <FieldTitle>Remote</FieldTitle>
        <FieldDescription className="text-foreground-muted">
          The git remote used for fetching and syncing worktrees. Defaults to{' '}
          <code className="font-mono text-xs">origin</code>.
        </FieldDescription>
        <Select value={remoteValue} onValueChange={(value) => update('remote', value ?? '')}>
          <SelectTrigger className="w-full min-w-0">
            <div className="flex min-w-0 flex-1 items-center gap-2 text-left">
              <span className="min-w-0 truncate">{selectedRemote?.name ?? remoteValue}</span>
            </div>
          </SelectTrigger>
          <SelectContent align="start" alignItemWithTrigger={false} sideOffset={6}>
            {remotes.length > 0 ? (
              remotes.map((r) => (
                <SelectItem key={r.name} value={r.name} className="py-2">
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <span className="relative -top-px shrink-0">{r.name}</span>
                    {r.url ? (
                      <span className="min-w-0 flex-1 truncate text-xs text-foreground-muted">
                        {r.url}
                      </span>
                    ) : null}
                  </div>
                </SelectItem>
              ))
            ) : (
              <SelectItem value="origin" className="py-2">
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <span className="relative -top-px shrink-0 font-medium">origin</span>
                </div>
              </SelectItem>
            )}
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
