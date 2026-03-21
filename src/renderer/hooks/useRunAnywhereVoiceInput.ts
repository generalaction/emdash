import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AudioCapture, ModelManager, ModelStatus } from '@runanywhere/web';
import { ONNX, STT } from '@runanywhere/web-onnx';
import type { VoiceInputModelId } from '@shared/voiceInput';
import {
  ensureRunAnywhereReady,
  ensureVoiceModelLoaded,
  formatVoiceInputError,
  getManagedVoiceModel,
} from '@/lib/voiceInputRuntime';

type VoiceInputPhase = 'idle' | 'preparing' | 'listening' | 'transcribing';
export type VoiceInputToggleResult =
  | 'started'
  | 'stopped'
  | 'download-required'
  | 'download-in-progress'
  | 'error'
  | 'noop';

/** Computed once — the browser environment never changes during the app lifecycle. */
const VOICE_INPUT_SUPPORTED =
  typeof navigator !== 'undefined' &&
  !!navigator.mediaDevices?.getUserMedia &&
  typeof window !== 'undefined' &&
  window.isSecureContext;

// At 16 kHz sample rate this is ~100ms of audio — anything shorter is probably
// accidental and not worth sending to the model.
const MIN_CAPTURED_SAMPLES = 1600;

export function useRunAnywhereVoiceInput(args: { modelId: VoiceInputModelId }) {
  const captureRef = useRef<AudioCapture | null>(null);
  const activeSessionRef = useRef(0);
  const [phase, setPhase] = useState<VoiceInputPhase>('idle');
  const [audioLevel, setAudioLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isSessionActive, setIsSessionActive] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [transcriptId, setTranscriptId] = useState(0);
  const [modelStatus, setModelStatus] = useState<ModelStatus | null>(null);

  useEffect(() => {
    if (!VOICE_INPUT_SUPPORTED) return;
    setModelStatus(getManagedVoiceModel(args.modelId)?.status ?? null);
    return ModelManager.onChange(() => {
      setModelStatus(getManagedVoiceModel(args.modelId)?.status ?? null);
    });
  }, [args.modelId]);

  useEffect(() => {
    return () => {
      captureRef.current?.stop();
      captureRef.current = null;
    };
  }, []);

  const startListening = useCallback(async (): Promise<VoiceInputToggleResult> => {
    setError(null);
    setPhase('preparing');
    setIsSessionActive(true);
    setTranscript('');

    const sessionId = activeSessionRef.current + 1;
    activeSessionRef.current = sessionId;

    try {
      await ensureRunAnywhereReady();
      if (activeSessionRef.current !== sessionId) return 'noop';

      const model = getManagedVoiceModel(args.modelId);
      if (!model) {
        throw new Error(`Voice input model is not registered: ${args.modelId}`);
      }

      if (model.status === ModelStatus.Registered) {
        setError(
          'Download the selected dictation model in Settings > Interface > Voice input before using the mic.'
        );
        setAudioLevel(0);
        setIsSessionActive(false);
        setPhase('idle');
        return 'download-required';
      }

      if (model.status === ModelStatus.Downloading) {
        setError(
          'The selected dictation model is still downloading. Finish it in Settings > Interface > Voice input.'
        );
        setAudioLevel(0);
        setIsSessionActive(false);
        setPhase('idle');
        return 'download-in-progress';
      }

      if (model.status === ModelStatus.Error) {
        setError(
          model.error ||
            'The selected dictation model needs attention in Settings > Interface > Voice input.'
        );
        setAudioLevel(0);
        setIsSessionActive(false);
        setPhase('idle');
        return 'error';
      }

      await ensureVoiceModelLoaded(args.modelId);
      if (activeSessionRef.current !== sessionId) return 'noop';

      setAudioLevel(0);

      const capture = new AudioCapture({
        sampleRate: 16000,
        channels: 1,
      });
      captureRef.current = capture;

      await capture.start(undefined, (level) => {
        if (activeSessionRef.current !== sessionId) return;
        setAudioLevel(level);
      });

      if (activeSessionRef.current !== sessionId) {
        capture.stop();
        if (captureRef.current === capture) {
          captureRef.current = null;
        }
        return 'noop';
      }

      setPhase('listening');
      return 'started';
    } catch (voiceError) {
      captureRef.current?.stop();
      captureRef.current = null;
      setAudioLevel(0);
      setError(formatVoiceInputError(voiceError));
      setIsSessionActive(false);
      setPhase('idle');
      return 'error';
    }
  }, [args.modelId]);

  const stopListening = useCallback(async (): Promise<VoiceInputToggleResult> => {
    const sessionId = activeSessionRef.current;
    const capture = captureRef.current;
    capture?.stop();
    captureRef.current = null;
    setAudioLevel(0);

    const finalSamples = capture?.getAudioBuffer() ?? new Float32Array(0);

    if (finalSamples.length >= MIN_CAPTURED_SAMPLES) {
      setPhase('transcribing');
      setError(null);

      try {
        const result = await STT.transcribe(finalSamples);
        if (activeSessionRef.current !== sessionId) return 'noop';
        setTranscript(result.text.trim());
        setTranscriptId((current) => current + 1);
      } catch (voiceError) {
        if (activeSessionRef.current !== sessionId) return 'noop';
        setError(formatVoiceInputError(voiceError));
      }
    }

    if (activeSessionRef.current === sessionId) {
      activeSessionRef.current += 1;
    }

    setIsSessionActive(false);
    setPhase('idle');
    return 'stopped';
  }, []);

  const cancelListening = useCallback(() => {
    const sessionId = activeSessionRef.current;
    captureRef.current?.stop();
    captureRef.current = null;
    setAudioLevel(0);
    setError(null);
    setIsSessionActive(false);
    setPhase('idle');
    setTranscript('');

    if (activeSessionRef.current === sessionId) {
      activeSessionRef.current += 1;
    }
  }, []);

  const toggleRecording = useCallback(async (): Promise<VoiceInputToggleResult> => {
    if (isSessionActive) {
      return stopListening();
    }
    if (phase === 'idle') {
      return startListening();
    }
    return 'noop';
  }, [isSessionActive, phase, startListening, stopListening]);

  const statusText = useMemo(() => {
    if (error) return error;
    if (phase === 'listening') return 'Listening... tap the mic again when you are done.';
    if (phase === 'transcribing') return 'Transcribing your recording...';
    if (phase === 'preparing') {
      if (modelStatus === ModelStatus.Downloading) return 'Downloading voice model...';
      if (modelStatus === ModelStatus.Loading) return 'Loading voice model...';
      return 'Preparing dictation...';
    }
    return null;
  }, [error, modelStatus, phase]);

  return {
    phase,
    audioLevel,
    error,
    isSessionActive,
    transcript,
    transcriptId,
    statusText,
    isSupported: VOICE_INPUT_SUPPORTED,
    cancelListening,
    toggleRecording,
    stopListening,
  };
}
