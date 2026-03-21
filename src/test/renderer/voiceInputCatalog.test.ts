import { describe, expect, it } from 'vitest';
import {
  getVoiceInputModelOption,
  isVoiceInputModelId,
  VOICE_INPUT_MODEL_OPTIONS,
} from '../../shared/voiceInput';

describe('voice input model catalog', () => {
  it('includes the shipped Whisper presets', () => {
    expect(VOICE_INPUT_MODEL_OPTIONS.map((option) => option.id)).toEqual([
      'whisper-tiny-en',
      'whisper-base-en-int8',
      'whisper-small-en-int8',
      'whisper-medium-en-int8',
    ]);
  });

  it('resolves catalog entries for known model ids', () => {
    const option = getVoiceInputModelOption('whisper-small-en-int8');
    expect(option?.label).toBe('Whisper Small');
    expect(option?.files).toEqual([
      'small.en-encoder.int8.onnx',
      'small.en-decoder.int8.onnx',
      'small.en-tokens.txt',
    ]);
  });

  it('validates model ids defensively', () => {
    expect(isVoiceInputModelId('whisper-medium-en-int8')).toBe(true);
    expect(isVoiceInputModelId('not-a-model')).toBe(false);
  });
});
