import * as fs from 'fs/promises';
import path from 'path';
import * as jsoncParser from 'jsonc-parser';
import * as toml from 'smol-toml';
import { log } from '../../lib/logger';
import type { AgentMcpMeta, ServerMap, RawServerEntry } from '@shared/mcp/types';

function parseJsoncConfig(content: string, configPath: string): Record<string, unknown> {
  const errors: jsoncParser.ParseError[] = [];
  const parsed = jsoncParser.parse(content, errors, {
    allowTrailingComma: true,
    disallowComments: false,
  });
  if (errors.length) {
    throw new Error(`Invalid JSONC in ${configPath}`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return {};
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
  if (meta.format === 'toml') {
    parsed = toml.parse(content) as Record<string, unknown>;
  } else if (meta.format === 'jsonc') {
    parsed = parseJsoncConfig(content, meta.configPath);
  } else {
    try {
      parsed = JSON.parse(content);
    } catch (error) {
      log.warn(`Invalid JSON in ${meta.configPath}:`, error);
      throw new Error(`Invalid JSON in ${meta.configPath}`);
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

  if (meta.format === 'toml') {
    existing = existingRaw
      ? (toml.parse(existingRaw) as Record<string, unknown>)
      : { ...meta.template };
    setAtPath(existing, meta.serversPath, servers);
    await fs.writeFile(
      meta.configPath,
      toml.stringify(existing as Parameters<typeof toml.stringify>[0])
    );
    return;
  }

  if (meta.format === 'jsonc' && existingRaw) {
    parseJsoncConfig(existingRaw, meta.configPath);
    // Use jsonc-parser modify() to preserve comments
    let modified = existingRaw;
    // First, set the entire servers object at the path
    const edits = jsoncParser.modify(modified, meta.serversPath, servers, {
      formattingOptions: { insertSpaces: true, tabSize: 2 },
    });
    modified = jsoncParser.applyEdits(modified, edits);
    await fs.writeFile(meta.configPath, modified);
    return;
  }

  // Plain JSON
  if (existingRaw) {
    try {
      existing = JSON.parse(existingRaw);
    } catch (error) {
      log.warn(`Invalid JSON in ${meta.configPath}:`, error);
      throw new Error(`Invalid JSON in ${meta.configPath}`);
    }
  } else {
    existing = JSON.parse(JSON.stringify(meta.template));
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
