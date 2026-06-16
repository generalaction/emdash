/**
 * Streaming scenario builders — pure, Solid-free functions that produce
 * ScriptStep[] arrays for use with ScriptedChat.
 *
 * No Solid imports so this module can run in the Node Vitest project.
 */

import type { ChatItem, ChatRole, ToolStatus } from '../../model';
import type { TranscriptApi } from '../../state/transcript';
import type { ScriptStep } from '../chat-host';

// ── Chunk splitting ───────────────────────────────────────────────────────────

export type ChunkMode = 'word' | 'char' | 'line';

/**
 * Split `text` into chunks preserving all whitespace so concatenation always
 * equals the original string.
 *
 * - `word` (default): splits on whitespace boundaries, keeping whitespace as
 *   its own atoms; `size` groups that many atoms per chunk.
 * - `char`: one Unicode code point per atom; `size` groups that many chars.
 * - `line`: one line (including its trailing `\n`) per atom.
 */
export function chunkText(text: string, opts: { mode?: ChunkMode; size?: number } = {}): string[] {
  const { mode = 'word', size = 1 } = opts;

  let atoms: string[];
  if (mode === 'char') {
    atoms = Array.from(text);
  } else if (mode === 'line') {
    // Split keeping the trailing newline attached to the preceding line.
    atoms = text.split(/(?<=\n)/);
    // Remove trailing empty string that split() can leave.
    if (atoms.length > 0 && atoms[atoms.length - 1] === '') atoms.pop();
  } else {
    // word: alternate between non-whitespace runs and whitespace runs.
    atoms = text.split(/(\s+)/).filter((a) => a.length > 0);
  }

  if (atoms.length === 0) return text.length > 0 ? [text] : [];

  const chunks: string[] = [];
  for (let i = 0; i < atoms.length; i += size) {
    chunks.push(atoms.slice(i, i + size).join(''));
  }
  return chunks;
}

// ── Composition helpers ───────────────────────────────────────────────────────

/** Flatten multiple step arrays into one. */
export function scenario(...parts: ScriptStep[][]): ScriptStep[] {
  return parts.flat();
}

/** Create a seed step from a list of items. */
export function seedStep(items: ChatItem[]): ScriptStep {
  return { kind: 'seed', items };
}

// ── Scenario builders ─────────────────────────────────────────────────────────

/**
 * Produce steps that stream an assistant (or user) message word-by-word.
 *
 * A zero-length `message_chunk` is emitted first — synchronously, before any
 * wait — so the row is created immediately in the virtualizer. This matches
 * the behavior of working scripted stories where the row exists before any
 * async timers fire.
 */
export function streamMessage(opts: {
  id: string;
  role?: ChatRole;
  text: string;
  /** Delay between chunks in ms (default: 60). */
  chunkMs?: number;
  /** Chunking options (default: word, size 1). */
  chunk?: { mode?: ChunkMode; size?: number };
  /** Emit turn_done at the end (default: true). */
  finalize?: boolean;
}): ScriptStep[] {
  const { id, role = 'assistant', text, chunkMs = 60, chunk = {}, finalize = true } = opts;
  const chunks = chunkText(text, chunk);

  const steps: ScriptStep[] = [];

  // Create the row synchronously so it exists before any setTimeout fires.
  steps.push({
    kind: 'call',
    fn: (api: TranscriptApi) => api.dispatch({ type: 'message_chunk', id, role, text: '' }),
  });

  for (const c of chunks) {
    steps.push({ kind: 'wait', ms: chunkMs });
    steps.push({
      kind: 'call',
      fn: (api: TranscriptApi) => api.dispatch({ type: 'message_chunk', id, role, text: c }),
    });
  }

  if (finalize) {
    steps.push({ kind: 'wait', ms: chunkMs });
    steps.push({
      kind: 'call',
      fn: (api: TranscriptApi) => api.dispatch({ type: 'turn_done' }),
    });
  }

  return steps;
}

/**
 * Produce steps that stream a thinking row, then mark it done.
 *
 * An empty `thinking_chunk` is emitted first (synchronously) to create the
 * row with `startedAt = Date.now()`. Subsequent chunks append text.
 */
export function streamThinking(opts: {
  id: string;
  text: string;
  /** Delay between chunks in ms (default: 60). */
  chunkMs?: number;
  /**
   * If provided, `thinking_done` is emitted with this exact duration.
   * Otherwise the duration is derived from `startedAt` at emit time.
   */
  durationMs?: number;
  /** Chunking options (default: word, size 2 — word+space pairs). */
  chunk?: { mode?: ChunkMode; size?: number };
}): ScriptStep[] {
  const { id, text, chunkMs = 60, durationMs, chunk = { mode: 'word', size: 2 } } = opts;
  const chunks = chunkText(text, chunk);

  const steps: ScriptStep[] = [];

  // Create the row synchronously; Date.now() runs at call time (dispatch time).
  steps.push({
    kind: 'call',
    fn: (api: TranscriptApi) =>
      api.dispatch({ type: 'thinking_chunk', id, text: '', startedAt: Date.now() }),
  });

  for (const c of chunks) {
    steps.push({ kind: 'wait', ms: chunkMs });
    steps.push({
      kind: 'call',
      fn: (api: TranscriptApi) => api.dispatch({ type: 'thinking_chunk', id, text: c }),
    });
  }

  steps.push({ kind: 'wait', ms: chunkMs });
  steps.push({
    kind: 'call',
    fn: (api: TranscriptApi) =>
      api.dispatch({
        type: 'thinking_done',
        id,
        ...(durationMs !== undefined ? { durationMs } : {}),
      }),
  });

  return steps;
}

/** A single timed update applied to a running tool call. */
export type ToolUpdateStep = {
  /** Milliseconds to wait after the previous step before applying this update. */
  afterMs: number;
  status?: ToolStatus;
  name?: string;
  inputSummary?: string;
  detail?: string;
};

/**
 * Produce steps that simulate a tool call: start immediately (synchronous),
 * then apply timed status/detail updates.
 */
export function streamTool(opts: {
  id: string;
  name: string;
  inputSummary?: string;
  steps: ToolUpdateStep[];
}): ScriptStep[] {
  const { id, name, inputSummary, steps: updates } = opts;

  const result: ScriptStep[] = [];

  result.push({
    kind: 'call',
    fn: (api: TranscriptApi) =>
      api.dispatch({ type: 'tool_start', id, name, ...(inputSummary ? { inputSummary } : {}) }),
  });

  for (const u of updates) {
    result.push({ kind: 'wait', ms: u.afterMs });
    result.push({
      kind: 'call',
      fn: (api: TranscriptApi) =>
        api.dispatch({
          type: 'tool_update',
          id,
          ...(u.status !== undefined ? { status: u.status } : {}),
          ...(u.name !== undefined ? { name: u.name } : {}),
          ...(u.inputSummary !== undefined ? { inputSummary: u.inputSummary } : {}),
          ...(u.detail !== undefined ? { detail: u.detail } : {}),
        }),
    });
  }

  return result;
}
