import {
  ModelCategory,
  ModelManager,
  ModelStatus,
  RunAnywhere,
  SDKEnvironment,
  type CompactModelDef,
  type ManagedModel,
} from '@runanywhere/web';
import { LLMFramework } from '@runanywhere/web';
import { ONNX } from '@runanywhere/web-onnx';
import {
  getVoiceInputModelOption,
  VOICE_INPUT_MODEL_OPTIONS,
  type VoiceInputModelId,
} from '@shared/voiceInput';

// The ONNX backend expects the glue JS module URL, not the .wasm directly.
// It derives the .wasm path from this URL internally.
const RUNANYWHERE_GLUE_URL = '/assets/sherpa/sherpa-onnx-glue.js';
const RUNANYWHERE_HELPER_BASE_URL = '/assets/sherpa/';

let initPromise: Promise<void> | null = null;
let registeredCatalog = false;

function isDevelopmentRenderer() {
  if (typeof window === 'undefined') return false;
  return window.location.hostname === 'localhost' || window.location.port === '3000';
}

function toCompactModelDef(modelId: VoiceInputModelId): CompactModelDef {
  const option = getVoiceInputModelOption(modelId);
  if (!option) {
    throw new Error(`Unknown voice input model: ${modelId}`);
  }

  return {
    id: option.id,
    name: option.label,
    ...(option.repo ? { repo: option.repo } : {}),
    ...(option.url ? { url: option.url } : {}),
    ...(option.files ? { files: option.files } : {}),
    ...(option.artifactType ? { artifactType: option.artifactType } : {}),
    framework: LLMFramework.ONNX,
    modality: ModelCategory.SpeechRecognition,
  };
}

export async function ensureRunAnywhereReady() {
  if (initPromise) {
    return initPromise;
  }

  initPromise = (async () => {
    if (!RunAnywhere.isInitialized) {
      await RunAnywhere.initialize({
        environment: isDevelopmentRenderer()
          ? SDKEnvironment.Development
          : SDKEnvironment.Production,
        debug: isDevelopmentRenderer(),
      });
    }

    if (!ONNX.isRegistered) {
      await ONNX.register({
        wasmUrl: RUNANYWHERE_GLUE_URL,
        helperBaseUrl: RUNANYWHERE_HELPER_BASE_URL,
      });
    }

    if (!registeredCatalog) {
      RunAnywhere.registerModels(
        VOICE_INPUT_MODEL_OPTIONS.map((option) => toCompactModelDef(option.id))
      );
      registeredCatalog = true;
    }
  })().catch((error) => {
    initPromise = null;
    throw error;
  });

  return initPromise;
}

export function getManagedVoiceModel(modelId: VoiceInputModelId): ManagedModel | null {
  return ModelManager.getModels().find((model) => model.id === modelId) ?? null;
}

export async function ensureVoiceModelLoaded(modelId: VoiceInputModelId) {
  await ensureRunAnywhereReady();

  const currentlyLoaded = ModelManager.getLoadedModel(ModelCategory.SpeechRecognition);
  if (currentlyLoaded?.id === modelId) return;

  const model = getManagedVoiceModel(modelId);
  if (!model) {
    throw new Error(`Voice input model is not registered: ${modelId}`);
  }

  if (model.status === ModelStatus.Registered) {
    await ModelManager.downloadModel(modelId);
  }

  const loaded = await ModelManager.loadModel(modelId);
  if (loaded) return;

  const nextModel = getManagedVoiceModel(modelId);
  throw new Error(nextModel?.error || `Failed to load voice input model: ${modelId}`);
}

export function formatVoiceInputError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/permission/i.test(message) || /notallowed/i.test(message)) {
    return 'Microphone access was denied.';
  }
  return message;
}
