import { Button, Tooltip } from '@emdash/ui/react/primitives';
import { Check, Loader2, Undo2 } from 'lucide-react';
import { ConfirmButton } from '@core/primitives/keybindings/browser/confirm-button';

export type ProjectSettingsSaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface ProjectSettingsFooterProps {
  dirty: boolean;
  saveStatus: ProjectSettingsSaveStatus;
  canShareConfig: boolean;
  shareDisabled: boolean;
  onShare: () => void;
  onUndo: () => void;
  onSave: () => void;
}

export function ProjectSettingsFooter({
  dirty,
  saveStatus,
  canShareConfig,
  shareDisabled,
  onShare,
  onUndo,
  onSave,
}: ProjectSettingsFooterProps) {
  const saving = saveStatus === 'saving';
  const saved = saveStatus === 'saved' && !dirty;
  const saveDisabled = saving || !dirty;

  return (
    <div className="flex justify-between gap-2 pt-5">
      <Tooltip.Provider delay={150}>
        <Tooltip.Root>
          <Tooltip.Trigger>
            <Button
              type="button"
              variant="secondary"
              className="shrink-0 gap-1.5"
              disabled={shareDisabled}
              hidden={!canShareConfig}
              onClick={onShare}
            >
              Share with team
            </Button>
          </Tooltip.Trigger>
          <Tooltip.Content side="bottom" align="end">
            Writes selected settings to .emdash.json. Commit that file to share these defaults with
            your team.
          </Tooltip.Content>
        </Tooltip.Root>
      </Tooltip.Provider>

      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          icon
          aria-label="Reset changes"
          onClick={onUndo}
          disabled={!dirty || saving}
        >
          <Undo2 />
        </Button>
        <ConfirmButton variant="primary" onClick={onSave} disabled={saveDisabled}>
          <span className="inline-flex min-w-22 items-center justify-center gap-1.5">
            {saving && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            {!saving && saved && <Check className="size-4" aria-hidden="true" />}
            {saving ? 'Saving…' : saved ? 'Saved' : 'Save settings'}
          </span>
        </ConfirmButton>
      </div>
    </div>
  );
}
