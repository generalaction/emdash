import type { UsageRecord } from './types';

/**
 * Parse a Pi agent transcript (`~/.pi/agent/sessions/**​/*.jsonl`).
 *
 * Mirrors CodexBar's PiSessionCostScanner: `model_change` lines carry the active
 * `provider`/`modelId`; `message` lines with `role: "assistant"` carry a `usage`
 * object (Pi uses many field-name variants for the same buckets). We record usage
 * under the underlying model id so it prices via the same model rate table, tagging
 * the provider as `pi`. Pi doesn't copy history across files, so ids are synthetic
 * per-line (no cross-file dedup), matching CodexBar.
 */

type Json = Record<string, unknown>;

function asObj(v: unknown): Json | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : null;
}
function asStr(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

/** First numeric value among the candidate keys (Pi varies field naming). */
function num(usage: Json, keys: string[]): number {
  for (const k of keys) {
    const v = usage[k];
    if (typeof v === 'number' && Number.isFinite(v)) return Math.max(0, v);
  }
  return 0;
}

const INPUT_KEYS = ['input', 'inputTokens', 'input_tokens', 'promptTokens', 'prompt_tokens'];
const CACHE_READ_KEYS = [
  'cacheRead',
  'cacheReadTokens',
  'cache_read',
  'cache_read_tokens',
  'cacheReadInputTokens',
  'cache_read_input_tokens',
];
const CACHE_WRITE_KEYS = [
  'cacheWrite',
  'cacheWriteTokens',
  'cache_write',
  'cache_write_tokens',
  'cacheCreationTokens',
  'cache_creation_tokens',
  'cacheCreationInputTokens',
  'cache_creation_input_tokens',
];
const OUTPUT_KEYS = [
  'output',
  'outputTokens',
  'output_tokens',
  'completionTokens',
  'completion_tokens',
];

/** Strip a leading "provider/" prefix so the id matches the rate table (e.g. anthropic/claude-x). */
function cleanModel(model: string | null): string | null {
  if (!model) return null;
  const parts = model.trim().split('/');
  return parts[parts.length - 1] || null;
}

/** The leading "provider/" segment, when a model id is namespaced (e.g. "google/gemini-x"). */
function vendorPrefix(model: string | null): string | null {
  if (!model) return null;
  const slash = model.indexOf('/');
  return slash > 0 ? model.slice(0, slash).trim().toLowerCase() : null;
}

function normVendor(v: string | null): string | null {
  const s = v?.trim().toLowerCase();
  return s ? s : null;
}

export function parsePiTranscript(text: string, filePath: string): UsageRecord[] {
  const out: UsageRecord[] = [];
  let currentModel: string | null = null;
  let currentVendor: string | null = null;
  let idx = 0;

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    let o: Json;
    try {
      o = JSON.parse(line) as Json;
    } catch {
      continue;
    }

    const type = asStr(o.type);
    if (type === 'model_change') {
      const rawModel = asStr(o.modelId) ?? asStr(o.model);
      currentVendor = normVendor(asStr(o.provider)) ?? vendorPrefix(rawModel) ?? currentVendor;
      currentModel = cleanModel(rawModel) ?? currentModel;
      continue;
    }
    if (type !== 'message') continue;

    const message = asObj(o.message);
    if (!message) continue;
    const role = asStr(message.role);
    if (role !== 'assistant' && role !== 'user') continue;

    const ts = asStr(o.timestamp) ?? asStr(message.timestamp) ?? '';
    const cwd = asStr(o.cwd) ?? asStr(o.workspacePath) ?? null;
    const sessionId = asStr(o.sessionId) ?? filePath;
    const rawModel =
      asStr(message.model) ?? asStr(message.modelId) ?? asStr(o.model) ?? asStr(o.modelId);
    const vendor =
      normVendor(asStr(message.provider) ?? asStr(o.provider)) ??
      vendorPrefix(rawModel) ??
      currentVendor ??
      '';
    const model = cleanModel(rawModel) ?? currentModel;

    if (role === 'user') {
      out.push({
        id: `pi:${filePath}:m${idx++}`,
        isMessage: true,
        provider: 'pi',
        vendor: '',
        ts,
        model: null,
        cwd,
        sessionId,
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
      });
      continue;
    }

    const usage = asObj(message.usage) ?? {};
    out.push({
      id: `pi:${filePath}:${idx++}`,
      isMessage: true,
      provider: 'pi',
      vendor,
      ts,
      model,
      cwd,
      sessionId,
      input: num(usage, INPUT_KEYS),
      output: num(usage, OUTPUT_KEYS),
      cacheRead: num(usage, CACHE_READ_KEYS),
      cacheWrite: num(usage, CACHE_WRITE_KEYS),
    });
  }
  return out;
}
