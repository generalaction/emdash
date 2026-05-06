import { RotateCcw } from 'lucide-react';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { Button } from '@renderer/lib/ui/button';
import { Textarea } from '@renderer/lib/ui/textarea';

export function ReviewPromptResetButton() {
  const { value, defaults, reset, isLoading, isSaving } = useAppSettingsKey('reviewPrompt');
  const canReset = (value ?? '') !== (defaults ?? '');
  const isVisible = !(isLoading || isSaving || !canReset);

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => reset()}
      disabled={!isVisible || isLoading || !canReset}
    >
      <RotateCcw />
    </Button>
  );
}

export function ReviewPromptSettingsCard() {
  const { value, update, isLoading, isSaving } = useAppSettingsKey('reviewPrompt');
  const reviewPrompt = value ?? '';

  return (
    <Textarea
      key={reviewPrompt}
      defaultValue={reviewPrompt}
      onBlur={(e) => {
        const next = e.target.value;
        if (next !== reviewPrompt) {
          update(next);
        }
      }}
      className="min-h-36 px-3 py-2.5 text-[14px] leading-relaxed"
      disabled={isLoading || isSaving}
    />
  );
}
