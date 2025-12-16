import React from 'react';
import { Play, Square, SlidersHorizontal, Loader2, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

export type RunConfigStatus = 'idle' | 'generating' | 'ready' | 'failed';

type Props = {
  status: RunConfigStatus;
  running: boolean;
  setupRunning?: boolean;
  setupError?: string | null;
  disabled?: boolean;
  error?: string | null;
  onRun: () => void;
  onStop: () => void;
  onOpenSettings: () => void;
};

export const RunControls: React.FC<Props> = ({
  status,
  running,
  setupRunning,
  setupError,
  disabled,
  error,
  onRun,
  onStop,
  onOpenSettings,
}) => {
  const isSettingUp = setupRunning === true;
  const isGenerating = status === 'generating' || isSettingUp;
  const isFailed = status === 'failed' || !!setupError;

  const primaryLabel = running
    ? 'Stop'
    : isSettingUp
      ? 'Setting up'
      : isGenerating
        ? 'Generating'
      : isFailed
        ? 'Fix'
        : 'Run';

  const PrimaryIcon = running
    ? Square
    : isGenerating
      ? Loader2
      : isFailed
        ? AlertTriangle
        : Play;

  const onPrimaryClick = running ? onStop : isFailed ? onOpenSettings : onRun;
  const effectiveError = setupError || error;

  const baseButtonColor = running
    ? 'bg-red-600 text-white border-red-600/40'
    : !isFailed
      ? 'bg-emerald-600 text-white border-emerald-600/40'
      : 'bg-amber-600 text-white border-amber-600/40';

  const hoverButtonColor = running
    ? 'hover:bg-red-500'
    : !isFailed
      ? 'hover:bg-emerald-500'
      : 'hover:bg-amber-500';

  return (
    <div
      className={cn(
        'inline-flex h-7 items-center overflow-hidden rounded-md border transition-colors',
        baseButtonColor,
        disabled && 'opacity-60'
      )}
    >
      <button
        type="button"
        onClick={onPrimaryClick}
        disabled={disabled || isGenerating}
        className={cn(
          'inline-flex h-full items-center gap-1.5 px-2.5 text-[11px] font-semibold transition-colors',
          hoverButtonColor,
          'disabled:cursor-not-allowed disabled:opacity-60'
        )}
        title={
          isFailed
            ? effectiveError || 'Run config generation failed. Open settings to fix.'
            : isGenerating
              ? isSettingUp
                ? 'Running setup steps (installing dependencies)...'
                : 'Generating run configuration...'
              : running
                ? 'Stop run'
                : 'Run project'
        }
      >
        <PrimaryIcon className={cn('h-3.5 w-3.5', isGenerating && 'animate-spin')} />
        <span>{primaryLabel}</span>
      </button>

      <div className="h-4 w-px bg-white/20" />

      <button
        type="button"
        onClick={onOpenSettings}
        disabled={disabled}
        className={cn(
          'inline-flex h-full w-7 items-center justify-center text-white/90 transition-colors',
          hoverButtonColor,
          'hover:text-white disabled:cursor-not-allowed disabled:opacity-60'
        )}
        title="Run settings"
      >
        <SlidersHorizontal className="h-3 w-3" strokeWidth={2} />
      </button>
    </div>
  );
};


