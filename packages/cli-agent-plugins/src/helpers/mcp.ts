import { parse as parseTOML, stringify as stringifyTOML } from 'smol-toml';
import type { McpServerRegistration } from '../core/capabilities';
import type { CLIAgentPluginFs } from '../core/plugin';

// ── Internal helpers ────────────────────────────────────────────────────────

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (cur, key) =>
        cur != null && typeof cur === 'object' ? (cur as Record<string, unknown>)[key] : undefined,
      obj
    );
}

function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split('.');
  const last = keys.pop()!;
  const target = keys.reduce<Record<string, unknown>>((cur, key) => {
    if (cur[key] == null || typeof cur[key] !== 'object') cur[key] = {};
    return cur[key] as Record<string, unknown>;
  }, obj);
  target[last] = value;
}

function deepClone<T>(obj: T): T {
  return structuredClone(obj);
}

const INJECTED_ACCEPT = 'application/json, text/event-stream';

function ensureHeader(headers: Record<string, string>, key: string, val: string): void {
  if (typeof headers[key] !== 'string') headers[key] = val;
}

function stripInjectedHeaders(entry: Record<string, unknown>): void {
  if (typeof entry.headers !== 'object' || entry.headers === null) return;
  const headers = entry.headers as Record<string, string>;
  if (headers.Accept === INJECTED_ACCEPT) {
    delete headers.Accept;
    if (!Object.keys(headers).length) delete entry.headers;
  }
}

// ── McpConfigShape ──────────────────────────────────────────────────────────

type McpConfigShape = {
  configPath: string;
  format: 'json' | 'toml';
  serversKey: string;
  toNative(server: McpServerRegistration): Record<string, unknown>;
  fromNative(name: string, raw: Record<string, unknown>): McpServerRegistration;
};

export function createMcpAdapter(shape: McpConfigShape) {
  return {
    async readServers(fs: CLIAgentPluginFs): Promise<McpServerRegistration[]> {
      const content = await fs.read(shape.configPath);
      if (!content) return [];
      const parsed =
        shape.format === 'json'
          ? (JSON.parse(content) as Record<string, unknown>)
          : (parseTOML(content) as Record<string, unknown>);
      const servers = getNestedValue(parsed, shape.serversKey) ?? {};
      return Object.entries(servers as Record<string, unknown>).map(([name, raw]) =>
        shape.fromNative(name, raw as Record<string, unknown>)
      );
    },
    async writeServers(fs: CLIAgentPluginFs, servers: McpServerRegistration[]): Promise<void> {
      const content = await fs.read(shape.configPath);
      const parsed: Record<string, unknown> = content
        ? shape.format === 'json'
          ? (JSON.parse(content) as Record<string, unknown>)
          : (parseTOML(content) as Record<string, unknown>)
        : {};
      const native = Object.fromEntries(servers.map((s) => [s.name, shape.toNative(s)]));
      setNestedValue(parsed, shape.serversKey, native);
      const output =
        shape.format === 'json' ? JSON.stringify(parsed, null, 2) + '\n' : stringifyTOML(parsed);
      await fs.write(shape.configPath, output);
    },
    async removeServer(fs: CLIAgentPluginFs, name: string): Promise<void> {
      const servers = await this.readServers(fs);
      await this.writeServers(
        fs,
        servers.filter((s) => s.name !== name)
      );
    },
  };
}

// ── Per-provider adapters ───────────────────────────────────────────────────

/** Passthrough adapter — agent uses canonical format (mcpServers JSON key). */
export function passthroughMcpAdapter(configPath: string) {
  return createMcpAdapter({
    configPath,
    format: 'json',
    serversKey: 'mcpServers',
    toNative(s) {
      const { name: _n, ...rest } = s;
      return rest as Record<string, unknown>;
    },
    fromNative(name, raw) {
      return { name, ...raw } as McpServerRegistration;
    },
  });
}

/**
 * Cursor adapter — HTTP servers drop `type`, but `url` stays.
 * Config: ~/.cursor/mcp.json, key: mcpServers, JSON.
 */
export function cursorMcpAdapter(configPath = '.cursor/mcp.json') {
  return createMcpAdapter({
    configPath,
    format: 'json',
    serversKey: 'mcpServers',
    toNative(s) {
      const { name: _n, type: _t, ...rest } = s as McpServerRegistration & { type?: string };
      return rest as Record<string, unknown>;
    },
    fromNative(name, raw) {
      const entry = deepClone(raw);
      if ('url' in entry && !('command' in entry)) {
        (entry as Record<string, unknown>).type = 'http';
      }
      return { name, ...entry } as McpServerRegistration;
    },
  });
}

/**
 * Codex adapter — TOML file, stdio-only (HTTP servers are dropped).
 * Config: ~/.codex/config.toml, key: mcp_servers.
 */
export function codexMcpAdapter(configPath = '.codex/config.toml') {
  return createMcpAdapter({
    configPath,
    format: 'toml',
    serversKey: 'mcp_servers',
    toNative(s) {
      const entry = deepClone(s) as Record<string, unknown>;
      // Codex only supports stdio; type field is omitted
      delete entry.name;
      delete entry.type;
      return entry;
    },
    fromNative(name, raw) {
      return { name, ...deepClone(raw) } as McpServerRegistration;
    },
  });
}

/**
 * Gemini adapter — HTTP servers use httpUrl instead of url; Accept header is injected.
 * Config: ~/.gemini/settings.json, key: mcpServers, JSON.
 */
export function geminiMcpAdapter(configPath = '.gemini/settings.json') {
  return createMcpAdapter({
    configPath,
    format: 'json',
    serversKey: 'mcpServers',
    toNative(s) {
      const entry = deepClone(s) as Record<string, unknown>;
      delete entry.name;
      if (entry.type === 'http') {
        const url = (entry.url as string) ?? '';
        const baseHeaders = (entry.headers as Record<string, string>) ?? {};
        const headers: Record<string, string> = { ...baseHeaders };
        ensureHeader(headers, 'Accept', INJECTED_ACCEPT);
        const result: Record<string, unknown> = { httpUrl: url, headers };
        if (entry.env) result.env = entry.env;
        return result;
      }
      delete entry.type;
      return entry;
    },
    fromNative(name, raw) {
      const entry = deepClone(raw) as Record<string, unknown>;
      if ('httpUrl' in entry) {
        const { httpUrl, ...rest } = entry;
        const result = { ...rest, type: 'http', url: httpUrl } as Record<string, unknown>;
        stripInjectedHeaders(result);
        return { name, ...result } as McpServerRegistration;
      }
      return { name, ...entry } as McpServerRegistration;
    },
  });
}

/**
 * Qwen adapter — same as Gemini (httpUrl ↔ url, Accept header).
 * Config: ~/.qwen/settings.json, key: mcpServers, JSON.
 */
export function qwenMcpAdapter(configPath = '.qwen/settings.json') {
  return geminiMcpAdapter(configPath);
}

/**
 * OpenCode adapter — type:'remote'/httpUrl for HTTP; type:'local'/command[] for stdio.
 * Config: ~/.opencode/config.json, key: mcp (NOT mcpServers), JSON.
 */
export function opencodeMcpAdapter(configPath = '.opencode/config.json') {
  return createMcpAdapter({
    configPath,
    format: 'json',
    serversKey: 'mcp',
    toNative(s) {
      const entry = deepClone(s) as Record<string, unknown>;
      delete entry.name;
      if (entry.type === 'http') {
        const url = (entry.url as string) ?? '';
        const baseHeaders = (entry.headers as Record<string, string>) ?? {};
        const headers: Record<string, string> = { ...baseHeaders };
        ensureHeader(headers, 'Accept', INJECTED_ACCEPT);
        const result: Record<string, unknown> = {
          type: 'remote',
          url,
          headers,
          enabled: true,
        };
        if (entry.env) result.env = entry.env;
        return result;
      }
      // stdio
      const cmdVec: string[] = [];
      if (typeof entry.command === 'string' && entry.command) cmdVec.push(entry.command as string);
      if (Array.isArray(entry.args)) cmdVec.push(...(entry.args as string[]));
      const result: Record<string, unknown> = { type: 'local', command: cmdVec, enabled: true };
      if (entry.env) result.environment = entry.env;
      return result;
    },
    fromNative(name, raw) {
      const entry = deepClone(raw) as Record<string, unknown>;
      if (entry.type === 'remote') {
        const { type: _t, enabled: _e, ...rest } = entry;
        const result = { ...rest, type: 'http' } as Record<string, unknown>;
        stripInjectedHeaders(result);
        return { name, ...result } as McpServerRegistration;
      }
      if (entry.type === 'local' && Array.isArray(entry.command)) {
        const cmdArr = entry.command as string[];
        const [command, ...args] = cmdArr;
        const result: Record<string, unknown> = {};
        if (command) result.command = command;
        if (args.length) result.args = args;
        if (entry.environment) result.env = entry.environment;
        return { name, ...result } as McpServerRegistration;
      }
      return { name, ...entry } as McpServerRegistration;
    },
  });
}

/**
 * Copilot adapter — injects `tools: ['*']` on write; strips it on read.
 * Config: ~/.config/github-copilot/mcp.json, key: mcpServers, JSON.
 */
export function copilotMcpAdapter(configPath = '.config/github-copilot/mcp.json') {
  return createMcpAdapter({
    configPath,
    format: 'json',
    serversKey: 'mcpServers',
    toNative(s) {
      const { name: _n, ...rest } = s;
      const entry = deepClone(rest) as Record<string, unknown>;
      if (!('tools' in entry)) entry.tools = ['*'];
      return entry;
    },
    fromNative(name, raw) {
      const entry = deepClone(raw) as Record<string, unknown>;
      if (Array.isArray(entry.tools) && entry.tools.length === 1 && entry.tools[0] === '*') {
        delete entry.tools;
      }
      return { name, ...entry } as McpServerRegistration;
    },
  });
}

/**
 * Droid (Factory AI) adapter — passthrough, uses mcpServers JSON key.
 * Config: ~/.factory/config.json.
 */
export function droidMcpAdapter(configPath = '.factory/config.json') {
  return passthroughMcpAdapter(configPath);
}

/**
 * Amp adapter — passthrough, uses mcpServers JSON key.
 * Config: ~/.amp/config.json.
 */
export function ampMcpAdapter(configPath = '.amp/config.json') {
  return passthroughMcpAdapter(configPath);
}
