import type { AdapterType, ServerMap, RawServerEntry } from '@shared/mcp/types';

// ── Helpers ────────────────────────────────────────────────────────────────

function isHttpServer(s: RawServerEntry): boolean {
  return s.type === 'http';
}

function isStdio(s: RawServerEntry): boolean {
  return !isHttpServer(s) && s.command !== undefined;
}

const INJECTED_ACCEPT = 'application/json, text/event-stream';

function ensureHeader(headers: Record<string, string>, key: string, val: string): void {
  if (typeof headers[key] !== 'string') {
    headers[key] = val;
  }
}

function stripInjectedHeaders(entry: RawServerEntry): void {
  if (typeof entry.headers !== 'object' || entry.headers === null) return;
  const headers = entry.headers as Record<string, string>;
  if (headers.Accept === INJECTED_ACCEPT) {
    delete headers.Accept;
    if (!Object.keys(headers).length) {
      delete entry.headers;
    }
  }
}

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

function transformHttpServers(
  servers: ServerMap,
  fn: (s: RawServerEntry) => RawServerEntry
): ServerMap {
  const result: ServerMap = {};
  for (const [k, v] of Object.entries(servers)) {
    if (typeof v === 'object' && v !== null && isHttpServer(v)) {
      result[k] = fn(deepClone(v));
    } else {
      result[k] = deepClone(v);
    }
  }
  return result;
}

// ── Forward Adapters (canonical → agent) ───────────────────────────────────

function fwdPassthrough(servers: ServerMap): ServerMap {
  return deepClone(servers);
}

function fwdGemini(servers: ServerMap): ServerMap {
  return transformHttpServers(servers, (s) => {
    const url = s.url ?? '';
    const headers: Record<string, string> = {
      ...((s.headers as Record<string, string>) ?? {}),
    };
    ensureHeader(headers, 'Accept', 'application/json, text/event-stream');
    const result: RawServerEntry = { httpUrl: url, headers };
    if (s.env && typeof s.env === 'object') result.env = s.env;
    return result;
  });
}

function fwdCursor(servers: ServerMap): ServerMap {
  return transformHttpServers(servers, (s) => {
    const url = s.url ?? '';
    const headers = s.headers ?? {};
    const result: RawServerEntry = { url, headers };
    if (s.env && typeof s.env === 'object') result.env = s.env;
    return result;
  });
}

function fwdCodex(servers: ServerMap): ServerMap {
  const result: ServerMap = {};
  for (const [k, v] of Object.entries(servers)) {
    if (typeof v === 'object' && v !== null && isStdio(v)) {
      result[k] = deepClone(v);
    }
  }
  return result;
}

function fwdOpencode(servers: ServerMap): ServerMap {
  const result: ServerMap = {};
  for (const [k, v] of Object.entries(servers)) {
    if (typeof v !== 'object' || v === null) {
      result[k] = v;
      continue;
    }
    if (isHttpServer(v)) {
      const headers: Record<string, string> = {
        ...((v.headers as Record<string, string>) ?? {}),
      };
      ensureHeader(headers, 'Accept', 'application/json, text/event-stream');
      const entry: RawServerEntry = { type: 'remote', url: v.url ?? '', headers, enabled: true };
      if (v.env && typeof v.env === 'object') entry.env = v.env;
      result[k] = entry;
    } else if (isStdio(v)) {
      const cmdVec: string[] = [];
      if (typeof v.command === 'string' && v.command) cmdVec.push(v.command);
      if (Array.isArray(v.args)) cmdVec.push(...(v.args as string[]));
      const entry: RawServerEntry = { type: 'local', command: cmdVec, enabled: true };
      if (v.env && typeof v.env === 'object') entry.env = v.env;
      result[k] = entry;
    } else {
      result[k] = deepClone(v);
    }
  }
  return result;
}

function fwdCopilot(servers: ServerMap): ServerMap {
  const result: ServerMap = {};
  for (const [k, v] of Object.entries(servers)) {
    if (typeof v === 'object' && v !== null && !('tools' in v)) {
      result[k] = { ...deepClone(v), tools: ['*'] };
    } else {
      result[k] = deepClone(v);
    }
  }
  return result;
}

// ── Reverse Adapters (agent → canonical) ───────────────────────────────────

function revPassthrough(servers: ServerMap): ServerMap {
  return deepClone(servers);
}

function revGemini(servers: ServerMap): ServerMap {
  const result: ServerMap = {};
  for (const [k, v] of Object.entries(servers)) {
    if (typeof v === 'object' && v !== null && 'httpUrl' in v) {
      const { httpUrl, ...rest } = v;
      const entry = { ...rest, type: 'http', url: httpUrl } as RawServerEntry;
      stripInjectedHeaders(entry);
      result[k] = entry;
    } else {
      result[k] = deepClone(v);
    }
  }
  return result;
}

function revCursor(servers: ServerMap): ServerMap {
  const result: ServerMap = {};
  for (const [k, v] of Object.entries(servers)) {
    if (typeof v === 'object' && v !== null && 'url' in v && !('command' in v)) {
      result[k] = { ...deepClone(v), type: 'http' };
    } else {
      result[k] = deepClone(v);
    }
  }
  return result;
}

function revCodex(servers: ServerMap): ServerMap {
  return deepClone(servers);
}

function revOpencode(servers: ServerMap): ServerMap {
  const result: ServerMap = {};
  for (const [k, v] of Object.entries(servers)) {
    if (typeof v !== 'object' || v === null) {
      result[k] = v;
      continue;
    }
    if (v.type === 'remote') {
      const { type: _, enabled: _e, ...rest } = v;
      const entry = { ...rest, type: 'http' } as RawServerEntry;
      stripInjectedHeaders(entry);
      result[k] = entry;
    } else if (v.type === 'local' && Array.isArray(v.command)) {
      const cmdArr = v.command as string[];
      const [command, ...args] = cmdArr;
      const entry: RawServerEntry = {};
      if (command) entry.command = command;
      if (args.length) entry.args = args;
      result[k] = entry;
    } else {
      result[k] = deepClone(v);
    }
  }
  return result;
}

function revCopilot(servers: ServerMap): ServerMap {
  const result: ServerMap = {};
  for (const [k, v] of Object.entries(servers)) {
    if (typeof v === 'object' && v !== null) {
      const clone = deepClone(v);
      if (Array.isArray(clone.tools) && clone.tools.length === 1 && clone.tools[0] === '*') {
        delete clone.tools;
      }
      result[k] = clone;
    } else {
      result[k] = v;
    }
  }
  return result;
}

// ── Public API ─────────────────────────────────────────────────────────────

const FORWARD: Record<AdapterType, (s: ServerMap) => ServerMap> = {
  passthrough: fwdPassthrough,
  gemini: fwdGemini,
  cursor: fwdCursor,
  codex: fwdCodex,
  opencode: fwdOpencode,
  copilot: fwdCopilot,
};

const REVERSE: Record<AdapterType, (s: ServerMap) => ServerMap> = {
  passthrough: revPassthrough,
  gemini: revGemini,
  cursor: revCursor,
  codex: revCodex,
  opencode: revOpencode,
  copilot: revCopilot,
};

export function adaptForward(adapter: AdapterType, servers: ServerMap): ServerMap {
  return FORWARD[adapter](servers);
}

export function adaptReverse(adapter: AdapterType, servers: ServerMap): ServerMap {
  return REVERSE[adapter](servers);
}
