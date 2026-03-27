import { ProjectSettings } from '@main/core/projects/settings/schema';
import { DialogContent, DialogHeader, DialogTitle } from '@renderer/components/ui/dialog';
import { Spinner } from '@renderer/components/ui/spinner';
import type { BaseModalProps } from '@renderer/core/modal/modal-provider';
import { useProjectSettings } from './use-project-settings';

export interface ProjectSettingsModalProps extends BaseModalProps<void> {
  projectId: string;
}

type FormState = {
  preservePatterns: string;
  shellSetup: string;
  tmux: boolean;
  scriptSetup: string;
  scriptRun: string;
  scriptTeardown: string;
  worktreeDirectory: string;
  defaultBranch: string;
  remote: string;
};

function normalizeScript(val: string | string[] | undefined): string {
  if (Array.isArray(val)) return val.join('\n');
  return val ?? '';
}

function settingsToForm(s: ProjectSettings): FormState {
  return {
    preservePatterns: (s.preservePatterns ?? []).join('\n'),
    shellSetup: s.shellSetup ?? '',
    tmux: s.tmux ?? false,
    scriptSetup: normalizeScript(s.scripts?.setup),
    scriptRun: normalizeScript(s.scripts?.run),
    scriptTeardown: normalizeScript(s.scripts?.teardown),
    worktreeDirectory: s.worktreeDirectory ?? '',
    defaultBranch: s.defaultBranch ?? '',
    remote: s.remote ?? '',
  };
}

function formToSettings(f: FormState): ProjectSettings {
  return {
    preservePatterns: f.preservePatterns
      .split('\n')
      .map((p) => p.trim())
      .filter(Boolean),
    shellSetup: f.shellSetup || undefined,
    tmux: f.tmux || undefined,
    scripts: {
      setup: f.scriptSetup,
      run: f.scriptRun,
      teardown: f.scriptTeardown,
    },
    worktreeDirectory: f.worktreeDirectory || undefined,
    defaultBranch: f.defaultBranch || undefined,
    remote: f.remote || undefined,
  };
}

interface ProjectSettingsFormProps {
  projectId: string;
  initial: ProjectSettings;
  onSuccess: () => void;
  onClose: () => void;
  save: (settings: ProjectSettings) => Promise<void>;
  isSaving: boolean;
}

function ProjectSettingsForm({
  projectId,
  initial,
  onSuccess,
  onClose,
  save,
  isSaving,
}: ProjectSettingsFormProps) {
  const { branches } = useBranches(projectId);
  const { remotes } = useRemotes(projectId);

  const [form, setForm] = useState<FormState>(() => settingsToForm(initial));
  const [original] = useState<FormState>(() => settingsToForm(initial));

  const isDirty = JSON.stringify(form) !== JSON.stringify(original);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    await save(formToSettings(form));
    onSuccess();
  }

  return (
    <>
      <ScrollArea className="max-h-[62vh]">
        <FieldGroup className="pr-1">
          <Field>
            <FieldTitle>Preserve patterns</FieldTitle>
            <FieldDescription>
              Gitignored files matching these glob patterns are copied from the main repo into each
              worktree. One pattern per line.
            </FieldDescription>
            <Textarea
              rows={5}
              placeholder={'.env\n.env.local\n.envrc'}
              value={form.preservePatterns}
              onChange={(e) => update('preservePatterns', e.target.value)}
            />
          </Field>

          <Separator />

          <Field>
            <FieldTitle>Worktree directory</FieldTitle>
            <FieldDescription>
              Override where worktrees are created. Defaults to the app-level worktree directory
              setting.
            </FieldDescription>
            <Input
              placeholder="Leave blank to use the default"
              value={form.worktreeDirectory}
              onChange={(e) => update('worktreeDirectory', e.target.value)}
            />
          </Field>

          <Separator />

          <Field>
            <FieldTitle>Default branch</FieldTitle>
            <FieldDescription>
              The branch new tasks are created from by default. Overrides the branch detected at
              project creation time.
            </FieldDescription>
            <BranchSelector
              branches={branches}
              value={form.defaultBranch ? { type: 'local', branch: form.defaultBranch } : undefined}
              onValueChange={(branch: Branch) => update('defaultBranch', branch.branch)}
            />
          </Field>

          <Separator />

          <Field>
            <FieldTitle>Remote</FieldTitle>
            <FieldDescription>
              The git remote used for fetching and syncing worktrees. Defaults to{' '}
              <code className="font-mono text-xs">origin</code>.
            </FieldDescription>
            <Select
              value={form.remote || 'origin'}
              onValueChange={(value) => update('remote', value ?? '')}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select a remote" />
              </SelectTrigger>
              <SelectContent>
                {remotes.length > 0 ? (
                  remotes.map((r) => (
                    <SelectItem key={r.name} value={r.name}>
                      {r.name}
                      <span className="ml-2 text-xs text-muted-foreground">{r.url}</span>
                    </SelectItem>
                  ))
                ) : (
                  <SelectItem value="origin">origin</SelectItem>
                )}
              </SelectContent>
            </Select>
          </Field>

          <Separator />

          <Field>
            <FieldTitle>Shell setup</FieldTitle>
            <FieldDescription>
              Shell commands run before each terminal session starts (e.g.{' '}
              <code className="font-mono text-xs">nvm use</code>).
            </FieldDescription>
            <Textarea
              rows={3}
              placeholder={'nvm use\nsource .envrc'}
              value={form.shellSetup}
              onChange={(e) => update('shellSetup', e.target.value)}
            />
          </Field>

          <Separator />

          <Field orientation="horizontal">
            <div className="flex flex-1 flex-col gap-1">
              <FieldTitle>Enable tmux</FieldTitle>
              <FieldDescription>
                Run all terminal sessions inside tmux for persistence across restarts.
              </FieldDescription>
            </div>
            <Switch checked={form.tmux} onCheckedChange={(checked) => update('tmux', checked)} />
          </Field>

          <Separator />

          <div className="flex flex-col gap-4">
            <div>
              <FieldTitle>Lifecycle scripts</FieldTitle>
              <FieldDescription className="mt-1">
                Shell commands run at each stage of the worktree lifecycle. One command per line.
              </FieldDescription>
            </div>

            <Field>
              <FieldTitle className="text-xs font-normal text-muted-foreground">Setup</FieldTitle>
              <Textarea
                rows={3}
                placeholder={'npm install\ncp .env.example .env'}
                value={form.scriptSetup}
                onChange={(e) => update('scriptSetup', e.target.value)}
              />
            </Field>

            <Field>
              <FieldTitle className="text-xs font-normal text-muted-foreground">Run</FieldTitle>
              <Textarea
                rows={3}
                placeholder="npm run dev"
                value={form.scriptRun}
                onChange={(e) => update('scriptRun', e.target.value)}
              />
            </Field>

            <Field>
              <FieldTitle className="text-xs font-normal text-muted-foreground">
                Teardown
              </FieldTitle>
              <Textarea
                rows={3}
                placeholder="docker compose down"
                value={form.scriptTeardown}
                onChange={(e) => update('scriptTeardown', e.target.value)}
              />
            </Field>
          </div>
        </FieldGroup>
      </ScrollArea>

      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={isSaving}>
          Cancel
        </Button>
        <ConfirmButton onClick={() => void handleSave()} disabled={!isDirty || isSaving}>
          {isSaving ? 'Saving…' : 'Save'}
        </ConfirmButton>
      </DialogFooter>
    </>
  );
}

export function ProjectSettingsModal({ projectId, onSuccess, onClose }: ProjectSettingsModalProps) {
  const { settings, isLoading, save, isSaving } = useProjectSettings(projectId);

  return (
    <DialogContent className="sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>Project settings</DialogTitle>
      </DialogHeader>

      {isLoading || !settings ? (
        <div className="flex items-center justify-center py-10">
          <Spinner />
        </div>
      ) : (
        <ProjectSettingsForm
          projectId={projectId}
          initial={settings}
          onSuccess={onSuccess}
          onClose={onClose}
          save={save}
          isSaving={isSaving}
        />
      )}
    </DialogContent>
  );
}
