import React, { useEffect, useRef } from 'react';
import { ArrowUp, CornerDownLeft, LoaderCircle, Mic, X } from 'lucide-react';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { ToastAction } from './ui/toast';
import { cn } from '@/lib/utils';
import { useAppSettings } from '@/contexts/AppSettingsProvider';
import { useToast } from '@/hooks/use-toast';
import { dispatchOpenSettingsPage } from '@/lib/settingsPageEvents';
import { DEFAULT_VOICE_INPUT_SETTINGS, getVoiceInputModelOption } from '@shared/voiceInput';
import { useRunAnywhereVoiceInput } from '@/hooks/useRunAnywhereVoiceInput';

interface TaskPromptBarProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => Promise<void> | void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}

const MAX_PROMPT_HEIGHT = 160;

function syncPromptHeight(textarea: HTMLTextAreaElement | null) {
  if (!textarea) return;

  textarea.style.height = '0px';
  const nextHeight = Math.min(textarea.scrollHeight, MAX_PROMPT_HEIGHT);
  textarea.style.height = `${Math.max(nextHeight, 40)}px`;
  textarea.style.overflowY = textarea.scrollHeight > MAX_PROMPT_HEIGHT ? 'auto' : 'hidden';
}

function VoiceRecordingWave({
  phase,
  audioLevel,
}: {
  phase: 'idle' | 'preparing' | 'listening' | 'transcribing';
  audioLevel: number;
}) {
  const normalizedLevel = Math.min(Math.max(audioLevel, 0), 1);
  const bars = Array.from({ length: 19 }, (_, index) => {
    const distanceFromCenter = Math.abs(index - 9);
    const centerWeight = Math.max(0.2, 1 - distanceFromCenter / 10);
    const activity =
      phase === 'listening' ? 0.3 + normalizedLevel * 0.9 : phase === 'transcribing' ? 0.5 : 0.25;
    const pulse = 0.75 + ((index % 3) + 1) * 0.08;
    return 8 + centerWeight * activity * pulse * 28;
  });

  return (
    <div className="flex flex-1 items-center justify-center px-2" aria-hidden="true">
      <div className="flex h-11 w-full max-w-[420px] items-end justify-center gap-1.5">
        {bars.map((height, index) => (
          <span
            key={index}
            className={cn(
              'w-1.5 rounded-full bg-foreground/75 transition-[height,opacity,background-color] duration-150 ease-out',
              phase === 'listening' ? 'opacity-100' : 'bg-muted-foreground/50 opacity-75'
            )}
            style={{ height }}
          />
        ))}
      </div>
    </div>
  );
}

function appendTranscription(existing: string, incoming: string) {
  const current = existing.trim();
  const next = incoming.trim();
  if (!next) return existing;
  if (!current) return next;
  return `${current} ${next}`;
}

export function TaskPromptBar({
  value,
  onChange,
  onSubmit,
  disabled = false,
  placeholder = 'Tell the agent what to do...',
  className,
}: TaskPromptBarProps) {
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const latestValueRef = useRef(value);
  const lastTranscriptIdRef = useRef(0);
  const { settings } = useAppSettings();
  const { toast } = useToast();
  const voiceSettings = settings?.voiceInput ?? DEFAULT_VOICE_INPUT_SETTINGS;
  const selectedModel = getVoiceInputModelOption(voiceSettings.modelId);
  const voiceInput = useRunAnywhereVoiceInput({
    modelId: voiceSettings.modelId,
  });
  const voiceModeActive =
    voiceInput.phase === 'preparing' ||
    voiceInput.phase === 'listening' ||
    voiceInput.phase === 'transcribing';
  const liveMicScale = voiceInput.isSessionActive
    ? 1 + Math.min(Math.max(voiceInput.audioLevel, 0), 1) * 0.25
    : 1;

  useEffect(() => {
    if (!voiceInput.statusText) return;
    inputRef.current?.focus();
    syncPromptHeight(inputRef.current);
  }, [voiceInput.statusText]);

  useEffect(() => {
    latestValueRef.current = value;
  }, [value]);

  useEffect(() => {
    syncPromptHeight(inputRef.current);
  }, [value]);

  useEffect(() => {
    if (voiceInput.transcriptId === 0 || voiceInput.transcriptId === lastTranscriptIdRef.current) {
      return;
    }

    lastTranscriptIdRef.current = voiceInput.transcriptId;

    if (!voiceInput.transcript) return;
    onChange(appendTranscription(latestValueRef.current, voiceInput.transcript));
  }, [onChange, voiceInput.transcript, voiceInput.transcriptId]);

  const submitDisabled =
    disabled || !value.trim() || voiceInput.isSessionActive || voiceInput.phase === 'transcribing';

  const handleVoiceToggle = async () => {
    const result = await voiceInput.toggleRecording();

    if (result === 'download-required' || result === 'download-in-progress') {
      const modelLabel = selectedModel?.label ?? 'The selected dictation model';
      toast({
        title:
          result === 'download-required'
            ? 'Download voice model first'
            : 'Voice model is still downloading',
        description:
          result === 'download-required'
            ? `${modelLabel} is not downloaded on this device yet. Open Settings > Interface > Voice input to download it.`
            : `${modelLabel} is still downloading. Open Settings > Interface > Voice input to finish preparing it.`,
        action: (
          <ToastAction
            altText="Open settings"
            onClick={() => dispatchOpenSettingsPage({ tab: 'interface' })}
          >
            Open settings
          </ToastAction>
        ),
      });
    }
  };

  if (voiceModeActive) {
    return (
      <div className={cn('mx-auto max-w-4xl', className)}>
        <div className="rounded-[30px] border border-border/70 bg-background/95 shadow-lg">
          <div className="flex items-center gap-3 px-3 py-2.5">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-12 w-12 shrink-0 rounded-full border border-border/70 bg-muted/30 text-foreground/80 hover:bg-muted/60 hover:text-foreground"
              onClick={() => {
                voiceInput.cancelListening();
              }}
              title="Cancel dictation"
              aria-label="Cancel dictation"
            >
              <X className="h-5 w-5" />
            </Button>
            <VoiceRecordingWave phase={voiceInput.phase} audioLevel={voiceInput.audioLevel} />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-12 w-12 shrink-0 rounded-full bg-foreground text-background shadow-sm hover:bg-foreground/90"
              disabled={voiceInput.phase === 'preparing' || voiceInput.phase === 'transcribing'}
              onClick={() => {
                void handleVoiceToggle();
              }}
              title="Finish dictation"
              aria-label="Finish dictation"
            >
              {voiceInput.phase === 'preparing' || voiceInput.phase === 'transcribing' ? (
                <LoaderCircle className="h-5 w-5 animate-spin" />
              ) : (
                <ArrowUp className="h-5 w-5" />
              )}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('mx-auto max-w-4xl', className)}>
      <div className="rounded-md border border-border bg-background shadow-lg">
        <div className="flex items-end gap-2 rounded-md px-4 py-3">
          <Textarea
            ref={inputRef}
            rows={1}
            className="max-h-40 min-h-[40px] flex-1 resize-none border-border bg-muted py-2"
            placeholder={placeholder}
            value={value}
            disabled={disabled}
            onChange={(event) => {
              onChange(event.target.value);
              syncPromptHeight(event.target);
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || event.shiftKey || submitDisabled) return;
              event.preventDefault();
              void onSubmit();
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={cn(
              'h-9 border border-border bg-muted px-3 text-xs font-medium hover:bg-muted',
              voiceInput.isSessionActive ? 'border-red-500/50 text-red-600' : undefined
            )}
            disabled={disabled || !voiceInput.isSupported}
            title={
              !voiceInput.isSupported
                ? 'Voice input is unavailable in this environment.'
                : voiceInput.isSessionActive
                  ? 'Finish dictation'
                  : 'Dictate into the prompt field'
            }
            aria-label={voiceInput.isSessionActive ? 'Finish dictation' : 'Start voice input'}
            onClick={() => {
              void handleVoiceToggle();
            }}
          >
            {voiceInput.phase === 'preparing' || voiceInput.phase === 'transcribing' ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <span
                className={cn(
                  'inline-flex items-center justify-center transition-transform duration-150',
                  voiceInput.isSessionActive ? 'text-red-600' : undefined
                )}
                style={{ transform: `scale(${liveMicScale})` }}
              >
                <Mic
                  className={cn(
                    'h-4 w-4',
                    voiceInput.isSessionActive ? 'animate-pulse' : undefined
                  )}
                />
              </span>
            )}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 border border-border bg-muted px-3 text-xs font-medium hover:bg-muted"
            onClick={() => {
              void onSubmit();
            }}
            disabled={submitDisabled}
            title="Send prompt (Enter)"
            aria-label="Send prompt"
          >
            <CornerDownLeft className="h-4 w-4" />
          </Button>
        </div>
        {voiceInput.statusText ? (
          <div className="flex items-center justify-between gap-3 border-t border-border/60 px-4 py-2 text-[11px] text-muted-foreground">
            <span>{voiceInput.statusText}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
