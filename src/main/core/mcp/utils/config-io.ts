import * as fs from 'fs/promises';
import path from 'path';
import * as jsoncParser from 'jsonc-parser';
import * as toml from 'smol-toml';
import type { AgentMcpMeta, RawServerEntry, ServerMap } from '@shared/mcp/types';
import { log } from '@main/lib/logger';

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
  } else if (meta.configPath.endsWith('.jsonc')) {
    const errors: jsoncParser.ParseError[] = [];
    parsed = (jsoncParser.parse(content, errors) ?? {}) as Record<string, unknown>;
    if (errors.length) {
      log.warn(`JSONC parse errors in ${meta.configPath}:`, errors);
    }
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
  await fs.mkdir(path.dirname(meta.configPath), { recursive: true });
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
      : { ...meta.template };
    setAtPath(existing, meta.serversPath, servers);
    await fs.writeFile(
      meta.configPath,
      toml.stringify(existing as Parameters<typeof toml.stringify>[0])
    );
    return;
  }

  if (meta.configPath.endsWith('.jsonc') && existingRaw) {
    let modified = existingRaw;
    const edits = jsoncParser.modify(modified, meta.serversPath, servers, {});
    modified = jsoncParser.applyEdits(modified, edits);
    await fs.writeFile(meta.configPath, modified);
    return;
  }

  if (existingRaw) {
    try {
      existing = JSON.parse(existingRaw);
    } catch {
      log.warn(`Invalid JSON in ${meta.configPath}, resetting to template`);
      existing = JSON.parse(JSON.stringify(meta.template));
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
