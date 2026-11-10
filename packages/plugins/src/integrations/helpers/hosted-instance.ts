import { err, ok, type Result } from '@emdash/shared';
import type { IntegrationError } from '../types';

const NETWORK_ERROR_CODES = new Set(['ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN']);

export function normalizeHostedInstanceUrl(instanceUrl: string): string | null {
  const trimmed = instanceUrl.trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    if (parsed.search || parsed.hash) {
      return null;
    }

    const pathname = parsed.pathname.replace(/\/+$/, '');
    return pathname && pathname !== '/'
      ? `${parsed.protocol}//${parsed.host}${pathname}`
      : `${parsed.protocol}//${parsed.host}`;
  } catch {
    return null;
  }
}

export function hasKnownNetworkErrorCode(error: unknown): boolean {
  const code = (error as { code?: unknown })?.code;
  return typeof code === 'string' && NETWORK_ERROR_CODES.has(code);
}

function defaultPortForProtocol(protocol: string): string | null {
  if (protocol === 'http:') return '80';
  if (protocol === 'https:') return '443';
  return null;
}

/** Split an already-lowercased remote host into hostname and explicit port, if any. */
function splitHostPort(host: string): { hostname: string; port: string | null } {
  if (host.startsWith('[')) {
    const end = host.indexOf(']');
    if (end === -1) return { hostname: host, port: null };
    const rest = host.slice(end + 1);
    return {
      hostname: host.slice(0, end + 1),
      port: rest.startsWith(':') ? rest.slice(1) : null,
    };
  }
  const idx = host.lastIndexOf(':');
  if (idx === -1) return { hostname: host, port: null };
  return { hostname: host.slice(0, idx), port: host.slice(idx + 1) };
}

export function checkRemoteHostMatchesInstance(
  remoteHost: string,
  instanceUrl: string,
  providerName: string
): Result<void, IntegrationError> {
  let instance: URL;
  try {
    instance = new URL(instanceUrl);
  } catch {
    return err({
      type: 'invalid_input',
      message: `A valid ${providerName} instance URL is required.`,
    });
  }

  const instanceHostname = instance.hostname.toLowerCase();
  // URL parsing drops default ports, so an explicit port survives only when
  // it is non-default for the instance's protocol.
  const instancePort = instance.port || defaultPortForProtocol(instance.protocol);
  // HTTP(S) remotes keep any non-default port (URL.host); scp-style and ssh
  // remotes carry no port at all, so they can only be checked by hostname.
  const remote = splitHostPort(remoteHost.toLowerCase());

  if (
    remote.hostname !== instanceHostname ||
    (remote.port !== null && remote.port !== instancePort)
  ) {
    return err({
      type: 'unsupported_host',
      message: `Git remote host "${remoteHost}" does not match configured ${providerName} instance "${instance.host.toLowerCase()}".`,
    });
  }

  return ok(undefined);
}
