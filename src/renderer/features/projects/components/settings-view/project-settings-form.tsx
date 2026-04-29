import { Check, Loader2, Undo2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useMemo, useState } from 'react';
import type { Branch } from '@shared/git';
import type { UpdateProjectSettingsError } from '@shared/projects';
import { err, type Result } from '@shared/result';
import type { ProjectSettings } from '@main/core/projects/settings/schema';
import { getRepositoryStore } from '@renderer/features/projects/stores/project-selectors';
import { ProjectBranchSelector } from '@renderer/lib/components/project-branch-selector';
import { rpc } from '@renderer/lib/ipc';
import { Button } from '@renderer/lib/ui/button';
import { ConfirmButton } from '@renderer/lib/ui/confirm-button';
import { Field, FieldDescription, FieldGroup, FieldTitle } from '@renderer/lib/ui/field';
import { Input } from '@renderer/lib/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/lib/ui/select';
import { Separator } from '@renderer/lib/ui/separator';
import { Switch } from '@renderer/lib/ui/switch';
import { Textarea } from '@renderer/lib/ui/textarea';
import { cn } from '@renderer/utils/utils';

type FormState = {
  preservePatterns: string;
  shellSetup: string;
  tmux: boolean;
  scriptSetup: string;
  scriptRun: string;
  scriptTeardown: string;
  worktreeDirectory: string;
  defaultBranch: Branch | null;
  remote: string;
};

function normalizeScript(val: string | string[] | undefined): string {
  if (Array.isArray(val)) return val.join('\n');
  return val ?? '';
}

export function settingsToForm(
  s: ProjectSettings,
  configuredRemote: string,
  remotes: { name: string; url: string }[]
): FormState {
  let defaultBranch: Branch | null = null;
  const configuredRemoteMeta = remotes.find((remote) => remote.name === configuredRemote) ?? {
    name: configuredRemote,
    url: '',
  };
  if (s.defaultBranch) {
    if (typeof s.defaultBranch === 'string') {
      defaultBranch = { type: 'local', branch: s.defaultBranch };
    } else {
      defaultBranch = {
        type: 'remote',
        branch: s.defaultBranch.name,
        remote: configuredRemoteMeta,
      };
    }
  }
  return {
    preservePatterns: (s.preservePatterns ?? []).join('\n'),
    shellSetup: s.shellSetup ?? '',
    tmux: s.tmux ?? false,
    scriptSetup: normalizeScript(s.scripts?.setup),
    scriptRun: normalizeScript(s.scripts?.run),
    scriptTeardown: normalizeScript(s.scripts?.teardown),
    worktreeDirectory: s.worktreeDirectory ?? '',
    defaultBranch,
    remote: s.remote ?? '',
  };
}

export function formToSettings(f: FormState): ProjectSettings {
  let defaultBranch: ProjectSettings['defaultBranch'];
  if (f.defaultBranch) {
    defaultBranch =
      f.defaultBranch.type === 'remote'
        ? { name: f.defaultBranch.branch, remote: true }
        : f.defaultBranch.branch;
  }
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
    defaultBranch,
    remote: f.remote || undefined,
  };
}

export interface ProjectSettingsFormProps {
  projectId: string;
  initial: ProjectSettings;
  onSuccess: () => void;
  save: (settings: ProjectSettings) => Promise<Result<void, UpdateProjectSettingsError>>;
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';
const EMPTY_REMOTES: { name: string; url: string }[] = [];

export const ProjectSettingsForm = observer(function ProjectSettingsForm({
  projectId,
  initial,
  onSuccess,
  save,
}: ProjectSettingsFormProps) {
  const repo = getRepositoryStore(projectId);
  const remotes = repo?.remotes ?? EMPTY_REMOTES;
  const configuredRemote = repo?.configuredRemote.name ?? 'origin';

  const baseline = useMemo(
    () => settingsToForm(initial, configuredRemote, remotes),
     
    [initial, configuredRemote, remotes]
  );
  const [form, setForm] = useState<FormState>(baseline);
  const [savedForm, setSavedForm] = useState<FormState>(baseline);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [worktreeDirectoryError, setWorktreeDirectoryError] = useState<string | null>(null);

  const formSnapshot = useMemo(() => JSON.stringify(form), [form]);
  const savedSnapshot = useMemo(() => JSON.stringify(savedForm), [savedForm]);
  const dirty = formSnapshot !== savedSnapshot;
  const saving = saveStatus === 'saving';
  const saved = saveStatus === 'saved' && !dirty;
  const saveDisabled = saving || !dirty;

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setSaveStatus((current) => (current === 'idle' ? current : 'idle'));
    if (key === 'worktreeDirectory' && worktreeDirectoryError) {
      setWorktreeDirectoryError(null);
    }
  }

  async function handleSave() {
    const formAtSubmit = form;
    setSaveStatus('saving');

    const result = await save(formToSettings(formAtSubmit)).catch(() => err({ type: 'error' }));

    if (result.success) {
      setWorktreeDirectoryError(null);
      setSavedForm(formAtSubmit);
      setSaveStatus('saved');
      onSuccess();
      return;
    }

    if (result.error.type === 'invalid-worktree-directory') {
      setWorktreeDirectoryError('Invalid worktree directory');
      setSaveStatus('idle');
      return;
    }

    setWorktreeDirectoryError(null);
    setSaveStatus('error');
  }

  return (
    <div className="flex flex-col max-w-3xl mx-auto w-full h-full overflow-hidden">
      <h1 className="text-lg font-medium pt-10 pb-5 px-10">Project Settings</h1>
      <div
        className="flex-1 overflow-y-auto overflow-x-hidden px-10"
        style={{ scrollbarWidth: 'none' }}
      >
        <FieldGroup>
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
            <FieldDescription>
              The branch new tasks are created from by default. Overrides the branch detected at
              project creation time.
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
              Shell commands run before the agent starts in each worktree session (e.g.{' '}
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
              <FieldDescription>Run the agent session inside a tmux session.</FieldDescription>
            </div>
            <Switch checked={form.tmux} onCheckedChange={(checked) => update('tmux', checked)} />
          </Field>

          <Separator />

          <div className="flex flex-col gap-4">
            <div>
              <FieldTitle>Lifecycle scripts</FieldTitle>
              <FieldDescription className="mt-1">
                Shell commands run at each stage of the worktree lifecycle. One command per line.
                <span> See </span>
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="group inline-flex h-auto cursor-pointer items-center gap-1 px-0 text-sm font-normal text-muted-foreground hover:text-foreground hover:no-underline focus-visible:outline-none focus-visible:ring-0"
                  onClick={() => rpc.app.openExternal('https://www.emdash.sh/docs/project-config')}
                >
                  <span className="font-mono text-xs transition-colors group-hover:text-foreground">
                    docs
                  </span>
                  <span className="text-sm text-muted-foreground transition-colors group-hover:text-foreground">
                    ↗
                  </span>
                </Button>
                <span> for the full project config reference.</span>
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
      </div>
      <div className="flex justify-end gap-2 pt-5 pb-10 px-10">
        <Button
          variant="outline"
          onClick={() => {
            setForm(savedForm);
            setWorktreeDirectoryError(null);
            if (saveStatus === 'error') setSaveStatus('idle');
          }}
          disabled={!dirty || saving}
        >
          <Undo2 />
        </Button>
        <ConfirmButton onClick={() => void handleSave()} disabled={saveDisabled}>
          <span className="inline-flex min-w-22 items-center justify-center gap-1.5">
            {saving && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            {!saving && saved && <Check className="size-4" aria-hidden="true" />}
            {saving ? 'Saving…' : saved ? 'Saved' : 'Save'}
          </span>
        </ConfirmButton>
      </div>
    </div>
  );
});
