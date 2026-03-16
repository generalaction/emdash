import { useState } from 'react';
import type { ProjectSettings } from '@main/core/projects/settings/schema';
import { Button } from '@renderer/components/ui/button';
import {
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/components/ui/dialog';
import { Field, FieldDescription, FieldGroup, FieldTitle } from '@renderer/components/ui/field';
import { Input } from '@renderer/components/ui/input';
import { ScrollArea } from '@renderer/components/ui/scroll-area';
import { Separator } from '@renderer/components/ui/separator';
import { Spinner } from '@renderer/components/ui/spinner';
import { Switch } from '@renderer/components/ui/switch';
import { Textarea } from '@renderer/components/ui/textarea';
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
  };
}

interface ProjectSettingsFormProps {
  initial: ProjectSettings;
  onSuccess: () => void;
  onClose: () => void;
  save: (settings: ProjectSettings) => Promise<void>;
  isSaving: boolean;
}

function ProjectSettingsForm({
  initial,
  onSuccess,
  onClose,
  save,
  isSaving,
}: ProjectSettingsFormProps) {
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
        <Button onClick={handleSave} disabled={!isDirty || isSaving}>
          {isSaving ? 'Saving…' : 'Save'}
        </Button>
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
