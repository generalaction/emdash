import React, { useEffect, useMemo, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Button } from './ui/button';
import { useAppSettings } from '@/contexts/AppSettingsProvider';
import { ModelManager, ModelStatus } from '@runanywhere/web';
import {
  DEFAULT_VOICE_INPUT_SETTINGS,
  getVoiceInputModelOption,
  VOICE_INPUT_MODEL_OPTIONS,
  type VoiceInputModelId,
} from '@shared/voiceInput';
import {
  ensureRunAnywhereReady,
  ensureVoiceModelLoaded,
  formatVoiceInputError,
  getManagedVoiceModel,
} from '@/lib/voiceInputRuntime';

export function VoiceInputSettingsCard() {
  const { settings, updateSettings, isLoading, isSaving } = useAppSettings();
  const voiceSettings = settings?.voiceInput ?? DEFAULT_VOICE_INPUT_SETTINGS;
  const selectedModel = getVoiceInputModelOption(voiceSettings.modelId);
  const [modelStatus, setModelStatus] = useState<ModelStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [isPreparingModel, setIsPreparingModel] = useState(false);

  useEffect(() => {
    let isActive = true;

    const updateModelStatus = () => {
      const model = getManagedVoiceModel(voiceSettings.modelId);
      setModelStatus(model?.status ?? null);
      setStatusError(model?.error ?? null);
    };

    void ensureRunAnywhereReady()
      .then(() => {
        if (!isActive) return;
        updateModelStatus();
      })
      .catch((error) => {
        if (!isActive) return;
        setStatusError(formatVoiceInputError(error));
      });

    const unsubscribe = ModelManager.onChange(() => {
      if (!isActive) return;
      updateModelStatus();
    });

    return () => {
      isActive = false;
      unsubscribe();
    };
  }, [voiceSettings.modelId]);

  const modelStatusLabel = useMemo(() => {
    if (statusError || modelStatus === ModelStatus.Error) {
      return statusError || 'The selected model is unavailable right now.';
    }

    switch (modelStatus) {
      case ModelStatus.Downloading:
        return 'Downloading on this device...';
      case ModelStatus.Downloaded:
        return 'Downloaded and ready to load.';
      case ModelStatus.Loading:
        return 'Loading on this device...';
      case ModelStatus.Loaded:
        return 'Ready on this device.';
      case ModelStatus.Registered:
        return 'Not downloaded on this device yet. Download it here before using the mic.';
      default:
        return 'Choose a model for dictation.';
    }
  }, [modelStatus, statusError]);

  const prepareButtonLabel = useMemo(() => {
    if (isPreparingModel || modelStatus === ModelStatus.Downloading) return 'Downloading...';
    if (modelStatus === ModelStatus.Loading) return 'Loading...';
    if (modelStatus === ModelStatus.Loaded) return 'Ready';
    if (modelStatus === ModelStatus.Downloaded) return 'Load model';
    if (modelStatus === ModelStatus.Error) return 'Retry';
    return 'Download model';
  }, [isPreparingModel, modelStatus]);

  const prepareModel = async () => {
    setStatusError(null);
    setIsPreparingModel(true);

    try {
      await ensureVoiceModelLoaded(voiceSettings.modelId);
    } catch (error) {
      setStatusError(formatVoiceInputError(error));
    } finally {
      setIsPreparingModel(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-muted p-4">
      <div className="flex flex-col gap-0.5">
        <p className="text-sm font-medium text-foreground">Voice input</p>
        <p className="text-sm text-muted-foreground">
          Choose which on-device model the app uses for dictation. Download the selected model here
          before first use. The selection applies anywhere the mic button appears.
        </p>
      </div>
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-1 flex-col gap-0.5">
          <p className="text-sm font-medium text-foreground">Dictation model</p>
          <p className="text-sm text-muted-foreground">
            {selectedModel?.description ??
              'Select the on-device Whisper model to use for dictation.'}
          </p>
        </div>
        <div className="w-[220px] flex-shrink-0">
          <Select
            value={voiceSettings.modelId}
            disabled={isLoading || isSaving}
            onValueChange={(value) =>
              updateSettings({
                voiceInput: {
                  provider: 'runanywhere',
                  modelId: value as VoiceInputModelId,
                },
              })
            }
          >
            <SelectTrigger className="h-9">
              <SelectValue placeholder="Choose a model" />
            </SelectTrigger>
            <SelectContent>
              {VOICE_INPUT_MODEL_OPTIONS.map((model) => (
                <SelectItem key={model.id} value={model.id}>
                  {model.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex items-center justify-between gap-4 rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">Model availability</p>
          <p className="text-sm text-muted-foreground">{modelStatusLabel}</p>
        </div>
        <Button
          type="button"
          variant="outline"
          className="shrink-0"
          disabled={
            isPreparingModel ||
            modelStatus === ModelStatus.Downloading ||
            modelStatus === ModelStatus.Loading ||
            modelStatus === ModelStatus.Loaded
          }
          onClick={() => {
            void prepareModel();
          }}
        >
          {isPreparingModel || modelStatus === ModelStatus.Downloading ? (
            <>
              <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
              {prepareButtonLabel}
            </>
          ) : (
            prepareButtonLabel
          )}
        </Button>
      </div>
      {selectedModel && (
        <p className="text-xs text-muted-foreground">
          Download profile: {selectedModel.downloadHint}. Larger models improve accuracy but take
          longer to download and load.
        </p>
      )}
    </div>
  );
}
