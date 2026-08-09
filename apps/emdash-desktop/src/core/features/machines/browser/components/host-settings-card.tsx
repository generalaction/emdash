import { SettingsCard } from '@emdash/ui/react/patterns';
import { Field, Input, Separator, Switch, Textarea, toast } from '@emdash/ui/react/primitives';
import { useEffect, useState } from 'react';
import { useHostSettings } from '../use-host-settings';

/**
 * Per-host defaults (host-settings runtime): shellSetup, worktree root, and tmux.
 * Text fields commit on blur; the switch commits immediately. External edits to the
 * host's settings file stream in through the live model while a field is not focused.
 */
export function HostSettingsCard({
  machineId,
  enabled = true,
}: {
  machineId?: string;
  enabled?: boolean;
}) {
  const { settings, parseError, isLoading, update } = useHostSettings(machineId, enabled);
  const [shellSetup, setShellSetup] = useState('');
  const [worktreeRoot, setWorktreeRoot] = useState('');
  const [editing, setEditing] = useState<'shellSetup' | 'worktreeRoot' | null>(null);

  useEffect(() => {
    if (editing !== 'shellSetup') setShellSetup(settings?.shellSetup ?? '');
  }, [settings?.shellSetup, editing]);
  useEffect(() => {
    if (editing !== 'worktreeRoot') setWorktreeRoot(settings?.worktreeRoot ?? '');
  }, [settings?.worktreeRoot, editing]);

  const commit = async (patch: Parameters<typeof update>[0]) => {
    try {
      await update(patch);
    } catch (error) {
      toast.error('Failed to save host settings', {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const commitText = (field: 'shellSetup' | 'worktreeRoot', value: string) => {
    setEditing(null);
    const trimmed = value.trim();
    if (trimmed === (settings?.[field] ?? '')) return;
    void commit({ [field]: trimmed || null });
  };

  const disabled = isLoading || settings === undefined;

  return (
    <SettingsCard>
      <Field.Root>
        <Field.Label>Host defaults</Field.Label>
        <Field.Description>
          Machine-level defaults applied to workspaces on this host. Stored in the host&apos;s
          emdash data directory; edits made to the file directly show up here live.
        </Field.Description>
      </Field.Root>
      <div className="mt-4 flex flex-col gap-4">
        {parseError ? (
          <div className="text-sm text-foreground-error">
            The host settings file could not be parsed; defaults are in effect until it is fixed.
          </div>
        ) : null}

        <Field.Root>
          <Field.Label>Shell setup</Field.Label>
          <Field.Description className="text-foreground-muted">
            Shell commands prepended to every lifecycle script and terminal session on this host
            (nvm, mise, …). A workspace&apos;s .emdash.json shellSetup overrides this.
          </Field.Description>
          <Textarea
            placeholder={'nvm use\nsource .envrc'}
            value={shellSetup}
            disabled={disabled}
            onFocus={() => setEditing('shellSetup')}
            onChange={(event) => setShellSetup(event.target.value)}
            onBlur={(event) => commitText('shellSetup', event.target.value)}
          />
        </Field.Root>

        <Separator />

        <Field.Root>
          <Field.Label>Worktree root</Field.Label>
          <Field.Description className="text-foreground-muted">
            Default directory new worktrees are created under on this host. Project settings can
            override it per project.
          </Field.Description>
          <Input
            placeholder="~/emdash/worktrees"
            value={worktreeRoot}
            disabled={disabled}
            onFocus={() => setEditing('worktreeRoot')}
            onChange={(event) => setWorktreeRoot(event.target.value)}
            onBlur={(event) => commitText('worktreeRoot', event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur();
            }}
          />
        </Field.Root>

        <Separator />

        <Field.Root orientation="horizontal">
          <div className="flex flex-1 flex-col gap-1">
            <Field.Label>Enable tmux by default</Field.Label>
            <Field.Description className="text-foreground-muted">
              Default tmux preference for sessions on this host. Project settings can override it
              per project.
            </Field.Description>
          </div>
          <Switch
            checked={settings?.tmux ?? false}
            disabled={disabled}
            onCheckedChange={(checked) => void commit({ tmux: checked })}
          />
        </Field.Root>
      </div>
    </SettingsCard>
  );
}
