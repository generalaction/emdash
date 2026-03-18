export const VOICE_INPUT_PROVIDERS = ['runanywhere'] as const;

export type VoiceInputProvider = (typeof VOICE_INPUT_PROVIDERS)[number];

export const VOICE_INPUT_MODEL_IDS = [
  'whisper-tiny-en',
  'whisper-base-en-int8',
  'whisper-small-en-int8',
  'whisper-medium-en-int8',
] as const;

export type VoiceInputModelId = (typeof VOICE_INPUT_MODEL_IDS)[number];

export interface VoiceInputSettings {
  provider: VoiceInputProvider;
  modelId: VoiceInputModelId;
}

export interface VoiceInputModelOption {
  id: VoiceInputModelId;
  label: string;
  description: string;
  downloadHint: string;
  repo?: string;
  url?: string;
  files?: string[];
  artifactType?: 'archive';
}

export const DEFAULT_VOICE_INPUT_SETTINGS: VoiceInputSettings = {
  provider: 'runanywhere',
  modelId: 'whisper-tiny-en',
};

export const VOICE_INPUT_MODEL_OPTIONS: VoiceInputModelOption[] = [
  {
    id: 'whisper-tiny-en',
    label: 'Whisper Tiny',
    description: 'Fastest startup and best default for prompt dictation. English only.',
    downloadHint: '~105 MB',
    url: 'https://huggingface.co/runanywhere/sherpa-onnx-whisper-tiny.en/resolve/main/sherpa-onnx-whisper-tiny.en.tar.gz',
    artifactType: 'archive',
  },
  {
    id: 'whisper-base-en-int8',
    label: 'Whisper Base',
    description: 'Better accuracy with a moderate download. English only.',
    downloadHint: 'Moderate download',
    repo: 'csukuangfj/sherpa-onnx-whisper-base.en',
    files: ['base.en-encoder.int8.onnx', 'base.en-decoder.int8.onnx', 'base.en-tokens.txt'],
  },
  {
    id: 'whisper-small-en-int8',
    label: 'Whisper Small',
    description: 'Higher accuracy with noticeably more disk and RAM usage. English only.',
    downloadHint: 'Large download',
    repo: 'csukuangfj/sherpa-onnx-whisper-small.en',
    files: ['small.en-encoder.int8.onnx', 'small.en-decoder.int8.onnx', 'small.en-tokens.txt'],
  },
  {
    id: 'whisper-medium-en-int8',
    label: 'Whisper Medium',
    description: 'Highest accuracy, but the heaviest option. Expect slower loads. English only.',
    downloadHint: 'Very large download',
    repo: 'csukuangfj/sherpa-onnx-whisper-medium.en',
    files: ['medium.en-encoder.int8.onnx', 'medium.en-decoder.int8.onnx', 'medium.en-tokens.txt'],
  },
];

export function isVoiceInputProvider(value: unknown): value is VoiceInputProvider {
  return typeof value === 'string' && VOICE_INPUT_PROVIDERS.includes(value as VoiceInputProvider);
}

export function isVoiceInputModelId(value: unknown): value is VoiceInputModelId {
  return typeof value === 'string' && VOICE_INPUT_MODEL_IDS.includes(value as VoiceInputModelId);
}

export function getVoiceInputModelOption(
  modelId: VoiceInputModelId | null | undefined
): VoiceInputModelOption | null {
  if (!modelId) return null;
  return VOICE_INPUT_MODEL_OPTIONS.find((option) => option.id === modelId) ?? null;
}
