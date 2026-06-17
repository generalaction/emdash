import { getDependencyManager } from '@main/core/dependencies/dependency-managers';
import type { DetectedMultiplexers } from '@main/core/pty/multiplexer';

/**
 * Probe boo + tmux availability on the given host (local when no connectionId).
 * `probe()` performs the real detection; `get()` is only a cache read and a fresh SSH manager
 * starts empty — so we MUST probe, or fresh remote workspaces report everything missing.
 */
export async function detectMultiplexers(connectionId?: string): Promise<DetectedMultiplexers> {
  const mgr = await getDependencyManager(connectionId);
  const [boo, tmux] = await Promise.all([mgr.probe('boo'), mgr.probe('tmux')]);
  return { boo: boo.status === 'available', tmux: tmux.status === 'available' };
}
