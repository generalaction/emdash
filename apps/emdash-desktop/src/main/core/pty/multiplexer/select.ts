import { log } from '@main/lib/logger';
import { booBackend } from './boo';
import { tmuxBackend } from './tmux';
import type { MultiplexerBackend, MultiplexerId, SessionKind } from './types';

export interface DetectedMultiplexers {
  boo: boolean;
  tmux: boolean;
}

const BACKENDS: Record<MultiplexerId, MultiplexerBackend> = {
  tmux: tmuxBackend,
  boo: booBackend,
};

export function backendFor(id: MultiplexerId): MultiplexerBackend {
  return BACKENDS[id];
}

/** Returns the backend to use, or null = no persistence (spawn the bare command + warn). */
export function selectMultiplexer(
  kind: SessionKind,
  detected: DetectedMultiplexers,
  override?: MultiplexerId
): MultiplexerBackend | null {
  if (kind === 'agent') {
    // EMDASH_AGENT_MULTIPLEXER forces a backend when detected; else warn + fall through.
    // Gated to agent sessions so terminals are never affected.
    if (override) {
      if (detected[override]) return BACKENDS[override];
      log.warn(
        `EMDASH_AGENT_MULTIPLEXER=${override} set but not detected; using normal selection`
      );
    }
    if (detected.boo) return booBackend;
    if (detected.tmux) return tmuxBackend;
    return null;
  }
  // terminals: tmux only, override ignored
  return detected.tmux ? tmuxBackend : null;
}
