import type { AcpJsonRpcTransport } from './json-rpc-transport';
import {
  ACP_PROTOCOL_VERSION,
  AcpProtocolError,
  isJsonObject,
  type AcpClientCapabilities,
  type AcpImplementationInfo,
  type AcpInitializeParams,
  type AcpInitializeResult,
  type JsonValue,
} from './types';

const DEFAULT_CLIENT_INFO: AcpImplementationInfo = {
  name: 'emdash',
  title: 'Emdash',
};

export async function initializeAcpConnection({
  transport,
  clientInfo = DEFAULT_CLIENT_INFO,
  timeoutMs,
}: {
  transport: AcpJsonRpcTransport;
  clientInfo?: AcpImplementationInfo;
  timeoutMs?: number;
}): Promise<AcpInitializeResult> {
  const params: AcpInitializeParams = {
    protocolVersion: ACP_PROTOCOL_VERSION,
    clientCapabilities: defaultClientCapabilities(),
    clientInfo,
  };
  const result = await transport.request('initialize', params as unknown as JsonValue, {
    timeoutMs,
  });
  return parseInitializeResult(result);
}

export function defaultClientCapabilities(): AcpClientCapabilities {
  return {};
}

export function parseInitializeResult(value: JsonValue): AcpInitializeResult {
  if (!isJsonObject(value)) {
    throw new AcpProtocolError('ACP initialize returned a non-object result', 'invalid_result');
  }
  const protocolVersion = value.protocolVersion;
  if (typeof protocolVersion !== 'number') {
    throw new AcpProtocolError('ACP initialize result omitted protocolVersion', 'invalid_result');
  }
  if (protocolVersion !== ACP_PROTOCOL_VERSION) {
    throw new AcpProtocolError(
      `Unsupported ACP protocol version: ${protocolVersion}`,
      'unsupported_protocol_version'
    );
  }

  return {
    protocolVersion,
    ...(isJsonObject(value.agentCapabilities)
      ? { agentCapabilities: value.agentCapabilities as AcpInitializeResult['agentCapabilities'] }
      : {}),
    ...(isJsonObject(value.agentInfo)
      ? { agentInfo: value.agentInfo as AcpInitializeResult['agentInfo'] }
      : {}),
    ...(Array.isArray(value.authMethods) ? { authMethods: value.authMethods } : {}),
  };
}
