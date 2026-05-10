/**
 * Provider session capability — single source of truth for everything emdash
 * needs to know about a provider's session lifecycle: how the provider names
 * its session, where the transcript lives, whether emdash needs to capture
 * the id post-spawn, and how to read the transcript back.
 *
 * Adding a new provider's transcript support = add one entry to
 * `manifest.ts`. No changes elsewhere.
 *
 * See docs/mcp-internal-spec.md §13a for the cleanup roadmap.
 */

import type { AgentProviderId } from '@shared/agent-provider-registry';

export interface ProviderSessionContext {
  home: string;
  taskPath: string;
  externalSessionId: string;
}

/** Outcome of a successful capture: the IDs to persist on the conversation row. */
export interface CaptureMatch {
  externalSessionId: string;
  /** Path to the transcript source — file, directory, or any opaque string the reader understands. */
  externalSourcePath: string;
}

/** Per-provider capture config. Plugged into the generic capture engine. */
export interface ProviderCaptureConfig {
  /** Base directory to watch (always recursive — handled by @parcel/watcher). */
  baseDir: (home: string) => string;
  /** Filter for entries (file or dir basename) that might be a new session. */
  matchesEntry: (basename: string) => boolean;
  /**
   * Inspect a candidate entry. Return a CaptureMatch if it's the session for
   * the given cwd, or null if it doesn't match (e.g. wrong cwd).
   */
  match: (entryPath: string, expectedCwd: string) => Promise<CaptureMatch | null>;
}

export interface TranscriptItem {
  id: string;
  parentId?: string;
  role: 'user' | 'assistant' | 'system';
  /** ISO 8601 timestamp. */
  timestamp: string;
  content: string;
}

export interface TranscriptFetchArgs {
  externalSessionId: string;
  /** Pre-resolved source path (file, dir, or opaque). null when capture pending. */
  externalSourcePath: string | null;
  limit?: number;
  /** Reader-defined cursor; for time-ordered readers, an ISO timestamp. */
  since?: string;
}

export interface TranscriptFetchResult {
  items: TranscriptItem[];
  nextCursor?: string;
}

export interface TranscriptReader {
  fetch(args: TranscriptFetchArgs): Promise<TranscriptFetchResult>;
}

export interface ProviderSessionCapability {
  /**
   * True when emdash sets the provider's session id at fresh launch (via
   * `--session-id <ourUUID>` or equivalent). When true, the session id +
   * transcript path are deterministic — no post-spawn capture needed.
   */
  acceptsSessionIdFlagAtSpawn: boolean;

  /**
   * Computes the deterministic transcript path given session context. Only
   * called when acceptsSessionIdFlagAtSpawn=true. Return null to leave the
   * path unset (reader must locate the source another way, e.g. shared db).
   */
  computeTranscriptPath?: (ctx: ProviderSessionContext) => string | null;

  /**
   * Post-spawn capture config. Required when acceptsSessionIdFlagAtSpawn=false
   * and transcript reading is supported. Omit when unsupported.
   */
  capture?: ProviderCaptureConfig;

  /** Transcript reader. Omit when transcript reading isn't yet supported. */
  reader?: TranscriptReader;
}

export type ProviderSessionManifest = Partial<Record<AgentProviderId, ProviderSessionCapability>>;
