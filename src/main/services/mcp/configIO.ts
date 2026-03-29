import * as fs from 'fs/promises';
import path from 'path';
import * as jsoncParser from 'jsonc-parser';
import * as toml from 'smol-toml';
import { log } from '../../lib/logger';
import type { AgentMcpMeta, ServerMap, RawServerEntry } from '@shared/mcp/types';

function isJsoncConfig(meta: AgentMcpMeta): boolean {
  return meta.isJsonc === true || meta.configPath.endsWith('.jsonc');
}

function cloneTemplate(template: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(template)) as Record<string, unknown>;
}

const JSONC_PARSE_OPTIONS: jsoncParser.ParseOptions = {
  allowTrailingComma: true,
  disallowComments: false,
};

function parseJsoncConfig(meta: AgentMcpMeta, content: string): Record<string, unknown> {
  const errors: jsoncParser.ParseError[] = [];
  const parsed = jsoncParser.parse(content, errors, JSONC_PARSE_OPTIONS);

  if (errors.length > 0 || typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    const details =
      errors.length > 0
        ? errors.map((error) => jsoncParser.printParseErrorCode(error.error)).join(', ')
        : 'root value must be an object';
    throw new Error(`Failed to safely parse JSONC config at ${meta.configPath}: ${details}`);
  }

  return parsed as Record<string, unknown>;
}

// ── Read ───────────────────────────────────────────────────────────────────

export async function readServers(meta: AgentMcpMeta): Promise<ServerMap> {
  let content: string;
  try {
    content = await fs.readFile(meta.configPath, 'utf-8');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw err;
  }

  if (!content.trim()) return {};

  let parsed: Record<string, unknown>;
  if (meta.isToml) {
    parsed = toml.parse(content) as Record<string, unknown>;
  } else if (isJsoncConfig(meta)) {
    parsed = parseJsoncConfig(meta, content);
  } else {
    try {
      parsed = JSON.parse(content);
    } catch {
      log.warn(`Invalid JSON in ${meta.configPath}, returning empty`);
      return {};
    }
  }

  return extractAtPath(parsed, meta.serversPath);
}

function extractAtPath(obj: Record<string, unknown>, pathSegments: string[]): ServerMap {
  let current: unknown = obj;
  for (const key of pathSegments) {
    if (typeof current !== 'object' || current === null) return {};
    current = (current as Record<string, unknown>)[key];
    if (current === undefined) return {};
  }
  if (typeof current !== 'object' || current === null || Array.isArray(current)) return {};
  // Filter out non-object entries and the "meta" key
  const result: ServerMap = {};
  for (const [k, v] of Object.entries(current as Record<string, unknown>)) {
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
      result[k] = v as RawServerEntry;
    }
  }
  return result;
}

// ── Write ──────────────────────────────────────────────────────────────────

export async function writeServers(meta: AgentMcpMeta, servers: ServerMap): Promise<void> {
  // Ensure parent directory exists
  await fs.mkdir(path.dirname(meta.configPath), { recursive: true });

  // Read existing config or use template
  let existing: Record<string, unknown>;
  let existingRaw: string | undefined;
  try {
    existingRaw = await fs.readFile(meta.configPath, 'utf-8');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }

  if (meta.isToml) {
    existing = existingRaw
      ? (toml.parse(existingRaw) as Record<string, unknown>)
      : cloneTemplate(meta.template);
    setAtPath(existing, meta.serversPath, servers);
    await fs.writeFile(
      meta.configPath,
      toml.stringify(existing as Parameters<typeof toml.stringify>[0])
    );
    return;
  }

  if (isJsoncConfig(meta)) {
    if (existingRaw && existingRaw.trim()) {
      // Validate/parse JSONC before computing edits; return value intentionally ignored
      // so jsonc-parser.modify/applyEdits can preserve the original comments/formatting.
      parseJsoncConfig(meta, existingRaw);
      const edits = jsoncParser.modify(existingRaw, meta.serversPath, servers, {});
      const modified = jsoncParser.applyEdits(existingRaw, edits);
      await fs.writeFile(meta.configPath, modified);
      return;
    }

    existing = cloneTemplate(meta.template);
    setAtPath(existing, meta.serversPath, servers);
    await fs.writeFile(meta.configPath, JSON.stringify(existing, null, 2));
    return;
  }

  // Plain JSON
  if (existingRaw) {
    try {
      existing = JSON.parse(existingRaw);
    } catch {
      log.warn(`Invalid JSON in ${meta.configPath}, resetting to template`);
      existing = cloneTemplate(meta.template);
    }
  } else {
    existing = cloneTemplate(meta.template);
  }
  setAtPath(existing, meta.serversPath, servers);
  await fs.writeFile(meta.configPath, JSON.stringify(existing, null, 2));
}

function setAtPath(obj: Record<string, unknown>, pathSegments: string[], value: unknown): void {
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < pathSegments.length - 1; i++) {
    const key = pathSegments[i];
    if (typeof current[key] !== 'object' || current[key] === null) {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }
  if (pathSegments.length > 0) {
    current[pathSegments[pathSegments.length - 1]] = value;
  }
}
