import { Readable, Writable } from 'node:stream';
import {
  ClientSideConnection,
  ndJsonStream,
  type Client,
  type LoadSessionRequest,
  type LoadSessionResponse,
  type NewSessionRequest,
  type NewSessionResponse,
  type SessionConfigOption,
  type SessionConfigSelectGroup,
  type SessionConfigSelectOption,
  type SetSessionConfigOptionRequest,
  type SetSessionConfigOptionResponse,
} from '@agentclientprotocol/sdk';
import type { AcpAgentApi, AcpClientFactory, AcpProcessIo } from '@emdash/core/agents/plugins';

type GrokModel = {
  modelId: string;
  name: string;
  description?: string | null;
};

type GrokModelState = {
  currentModelId: string;
  availableModels: GrokModel[];
};

type GrokSessionResponse = {
  models?: unknown;
};

type SetGrokModelResponse = {
  _meta?: Record<string, unknown> | null;
};

export function connectGrokAcp(io: AcpProcessIo, toClient: AcpClientFactory): AcpAgentApi {
  const stream = ndJsonStream(
    Writable.toWeb(io.stdin) as WritableStream<Uint8Array>,
    Readable.toWeb(io.stdout) as unknown as ReadableStream<Uint8Array>
  );
  let client: Client | null = null;
  const connection = new ClientSideConnection((agent) => {
    const resolvedClient = toClient(agent as never);
    client = resolvedClient;
    return resolvedClient;
  }, stream);
  const sessions = new Map<string, SessionConfigOption[]>();

  return {
    initialize: (params) => connection.initialize(params),
    newSession: async (params: NewSessionRequest) => {
      const response = await connection.newSession(params);
      return normalizeSessionResponse(response, response.sessionId, sessions, false);
    },
    loadSession: async (params: LoadSessionRequest) => {
      const response = await connection.loadSession(params);
      return normalizeSessionResponse(response, params.sessionId, sessions, true);
    },
    prompt: async (params) => {
      const lockedOptions = lockModelOptions(sessions.get(params.sessionId));
      if (lockedOptions) {
        sessions.set(params.sessionId, lockedOptions);
        await client?.sessionUpdate({
          sessionId: params.sessionId,
          update: { sessionUpdate: 'config_option_update', configOptions: lockedOptions },
        });
      }
      return connection.prompt(params);
    },
    cancel: (params) => connection.cancel(params),
    setSessionConfigOption: (params) => setSessionConfigOption(connection, sessions, params),
    setSessionMode: (params) => connection.setSessionMode(params),
    closeSession: async (params) => {
      try {
        return await connection.closeSession(params);
      } finally {
        sessions.delete(params.sessionId);
      }
    },
  };
}

async function setSessionConfigOption(
  connection: ClientSideConnection,
  sessions: Map<string, SessionConfigOption[]>,
  params: SetSessionConfigOptionRequest
): Promise<SetSessionConfigOptionResponse> {
  if (params.configId !== 'model' || typeof params.value !== 'string') {
    return connection.setSessionConfigOption(params);
  }

  const currentOptions = sessions.get(params.sessionId);
  if (!currentOptions) {
    throw new Error(`Grok session '${params.sessionId}' does not expose model state`);
  }

  const modelId = params.value;
  const response = await connection.request<
    SetGrokModelResponse,
    { sessionId: string; modelId: string }
  >('session/set_model', {
    sessionId: params.sessionId,
    modelId,
  });
  const configOptions = currentOptions.map((option) =>
    option.id === 'model' && option.type === 'select'
      ? { ...option, currentValue: modelId }
      : option
  );
  sessions.set(params.sessionId, configOptions);

  return {
    configOptions,
    ...(response._meta !== undefined ? { _meta: response._meta } : {}),
  };
}

function normalizeSessionResponse<T extends NewSessionResponse | LoadSessionResponse>(
  response: T,
  sessionId: string,
  sessions: Map<string, SessionConfigOption[]>,
  locked: boolean
): T {
  const models = parseGrokModelState((response as T & GrokSessionResponse).models);
  if (!models) return response;

  const normalizedOptions = replaceModelOption(response.configOptions ?? [], models);
  const configOptions = locked
    ? (lockModelOptions(normalizedOptions) ?? normalizedOptions)
    : normalizedOptions;
  sessions.set(sessionId, configOptions);
  return { ...response, configOptions };
}

function lockModelOptions(
  configOptions: readonly SessionConfigOption[] | undefined
): SessionConfigOption[] | null {
  if (!configOptions) return null;
  let modelOption: SessionConfigOption | null = null;
  for (const option of configOptions) {
    if (option.id === 'model' && option.type === 'select') {
      modelOption = option;
      break;
    }
  }
  if (!modelOption || modelOption.type !== 'select' || modelOption.options.length < 2) return null;
  const modelOptions = modelOption.options;
  if (!modelOptions.every(isSelectOption)) return null;

  const family = grokAgentFamily(modelOption.currentValue);
  return configOptions.map((option) =>
    option === modelOption
      ? {
          ...modelOption,
          options: modelOptions.filter((candidate) => grokAgentFamily(candidate.value) === family),
        }
      : option
  );
}

function isSelectOption(
  option: SessionConfigSelectOption | SessionConfigSelectGroup
): option is SessionConfigSelectOption {
  return 'value' in option;
}

function grokAgentFamily(modelId: string): 'cursor' | 'grok-build' {
  return modelId.startsWith('grok-composer-') ? 'cursor' : 'grok-build';
}

function replaceModelOption(
  configOptions: readonly SessionConfigOption[],
  models: GrokModelState
): SessionConfigOption[] {
  return [
    ...configOptions.filter((option) => option.id !== 'model' && option.category !== 'model'),
    toModelConfigOption(models),
  ];
}

function toModelConfigOption(models: GrokModelState): SessionConfigOption {
  const currentValue = resolveCurrentModelId(models.currentModelId, models.availableModels);
  return {
    id: 'model',
    name: 'Model',
    category: 'model',
    type: 'select',
    currentValue,
    options: models.availableModels.map((model) => ({
      value: model.modelId,
      name: model.name,
      ...(model.description ? { description: model.description } : {}),
    })),
  };
}

function resolveCurrentModelId(currentModelId: string, availableModels: GrokModel[]): string {
  const ids = availableModels.map((model) => model.modelId);
  if (ids.includes(currentModelId)) return currentModelId;
  return (
    ids
      .filter((id) => currentModelId.startsWith(`${id}-`))
      .sort((left, right) => right.length - left.length)[0] ?? currentModelId
  );
}

function parseGrokModelState(value: unknown): GrokModelState | null {
  if (!isRecord(value)) return null;
  const currentModelId = stringProperty(value, 'currentModelId');
  if (!currentModelId || !Array.isArray(value.availableModels)) return null;

  const availableModels = value.availableModels.flatMap((candidate): GrokModel[] => {
    if (!isRecord(candidate)) return [];
    const modelId = stringProperty(candidate, 'modelId');
    const name = stringProperty(candidate, 'name');
    if (!modelId || !name) return [];
    const description = stringProperty(candidate, 'description');
    return [{ modelId, name, ...(description ? { description } : {}) }];
  });
  if (availableModels.length === 0) return null;

  return { currentModelId, availableModels };
}

function stringProperty(value: unknown, property: string): string | null {
  if (!isRecord(value)) return null;
  const candidate = value[property];
  return typeof candidate === 'string' ? candidate : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
