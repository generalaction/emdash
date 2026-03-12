import React from 'react';
import { useAppSettings } from '@/contexts/AppSettingsProvider';
import { Input } from './ui/input';
import type { RemoteBranchCleanupMode } from '../../shared/remoteBranchCleanup';

const CLEANUP_OPTIONS: { value: RemoteBranchCleanupMode; label: string; description: string }[] = [
  {
    value: 'never',
    label: 'Never delete',
    description: 'Keep remote branches when archiving or deleting tasks (default).',
  },
  {
    value: 'ask',
    label: 'Ask every time',
    description: 'Prompt before deleting the remote branch.',
  },
  {
    value: 'always',
    label: 'Always delete',
    description: 'Automatically delete the remote branch on archive or delete.',
  },
  {
    value: 'auto',
    label: 'Auto-delete after threshold',
    description:
      'Delete remote branches whose last commit is older than a configurable number of days.',
  },
];

const RemoteBranchCleanupCard: React.FC = () => {
  const { settings, updateSettings, isLoading: loading, isSaving: saving } = useAppSettings();

  const currentMode: RemoteBranchCleanupMode = settings?.repository?.remoteBranchCleanup ?? 'never';
  const currentDays = settings?.repository?.remoteBranchCleanupDaysThreshold ?? 7;

  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">
        Choose how remote branches are handled when a task is archived or deleted.
      </p>

      <div className="grid gap-2">
        {CLEANUP_OPTIONS.map((option) => {
          const isSelected = currentMode === option.value;
          return (
            <label
              key={option.value}
              className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors ${
                isSelected ? 'border-primary/50 bg-primary/5' : 'border-border hover:bg-muted/40'
              } ${loading || saving ? 'pointer-events-none opacity-60' : ''}`}
            >
              <input
                type="radio"
                name="remoteBranchCleanup"
                value={option.value}
                checked={isSelected}
                onChange={() =>
                  updateSettings({
                    repository: { remoteBranchCleanup: option.value },
                  })
                }
                disabled={loading || saving}
                className="mt-0.5 accent-primary"
              />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-foreground">{option.label}</div>
                <div className="text-xs text-muted-foreground">{option.description}</div>
              </div>
            </label>
          );
        })}
      </div>

      {/* Days threshold — only visible in 'auto' mode */}
      {currentMode === 'auto' && (
        <div className="ml-7 grid gap-1.5">
          <label htmlFor="cleanupDays" className="text-sm font-medium text-foreground">
            Days threshold
          </label>
          <div className="flex items-center gap-2">
            <Input
              id="cleanupDays"
              type="number"
              min={1}
              max={365}
              defaultValue={currentDays}
              onBlur={(e) => {
                const raw = parseInt(e.target.value, 10);
                if (!Number.isFinite(raw) || raw < 1) {
                  e.target.value = String(currentDays);
                  return;
                }
                const clamped = Math.min(365, Math.max(1, raw));
                updateSettings({
                  repository: { remoteBranchCleanupDaysThreshold: clamped },
                });
              }}
              disabled={loading || saving}
              className="w-24"
              aria-label="Days threshold for auto-delete"
            />
            <span className="text-xs text-muted-foreground">Days since last commit</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default RemoteBranchCleanupCard;
