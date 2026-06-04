export const ACP_PROTOCOL_VERSION = 1;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type JsonRpcId = string | number;

export type JsonRpcRequest = {
  jsonrpc: '2.0';
  id: JsonRpcId;
  method: string;
  params?: JsonValue;
};

export type JsonRpcNotification = {
  jsonrpc: '2.0';
  method: string;
  params?: JsonValue;
};

export type JsonRpcSuccess = {
  jsonrpc: '2.0';
  id: JsonRpcId;
  result: JsonValue;
};

export type JsonRpcErrorObject = {
  code: number;
  message: string;
  data?: JsonValue;
};

export type JsonRpcFailure = {
  jsonrpc: '2.0';
  id: JsonRpcId | null;
  error: JsonRpcErrorObject;
};

export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcSuccess | JsonRpcFailure;

export type AcpImplementationInfo = {
  name?: string;
  title?: string;
  version?: string;
};

export type AcpClientCapabilities = {
  fs?: {
    readTextFile?: boolean;
    writeTextFile?: boolean;
  };
  terminal?: boolean;
};

export type AcpAgentCapabilities = {
  loadSession?: boolean;
  promptCapabilities?: {
    image?: boolean;
    audio?: boolean;
    embeddedContext?: boolean;
  };
  sessionCapabilities?: {
    resume?: JsonObject;
    close?: JsonObject;
    additionalDirectories?: JsonObject;
  };
  mcpCapabilities?: {
    http?: boolean;
    sse?: boolean;
  };
};

export type AcpInitializeParams = {
  protocolVersion: typeof ACP_PROTOCOL_VERSION;
  clientCapabilities: AcpClientCapabilities;
  clientInfo: AcpImplementationInfo;
};

export type AcpInitializeResult = {
  protocolVersion: number;
  agentCapabilities?: AcpAgentCapabilities;
  agentInfo?: AcpImplementationInfo;
  authMethods?: JsonValue[];
};

export class AcpProtocolError extends Error {
  constructor(
    message: string,
    readonly code: string
  ) {
    super(message);
    this.name = 'AcpProtocolError';
  }
}

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isJsonRpcId(value: unknown): value is JsonRpcId {
  return typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value));
}

export function parseJsonRpcMessage(value: unknown): JsonRpcMessage | null {
  if (!isJsonObject(value) || value.jsonrpc !== '2.0') return null;

  if (typeof value.method === 'string') {
    if ('id' in value) {
      return isJsonRpcId(value.id)
        ? {
            jsonrpc: '2.0',
            id: value.id,
            method: value.method,
            ...('params' in value ? { params: value.params } : {}),
          }
        : null;
    }
    return {
      jsonrpc: '2.0',
      method: value.method,
      ...('params' in value ? { params: value.params } : {}),
    };
  }

  if ('id' in value && (isJsonRpcId(value.id) || value.id === null)) {
    if ('result' in value) {
      return isJsonRpcId(value.id) ? { jsonrpc: '2.0', id: value.id, result: value.result } : null;
    }
    if (isJsonObject(value.error)) {
      const { code, message, data } = value.error;
      if (typeof code !== 'number' || typeof message !== 'string') return null;
      return {
        jsonrpc: '2.0',
        id: value.id,
        error: {
          code,
          message,
          ...('data' in value.error ? { data } : {}),
        },
      };
    }
  }

  return null;
}

export function formatJsonRpcError(error: JsonRpcErrorObject): string {
  const data = error.data === undefined ? '' : ` ${safeJsonStringify(error.data)}`;
  return `${error.code}: ${error.message}${data}`;
}

export function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
