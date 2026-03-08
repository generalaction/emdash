/**
 * PtyPoolService — pre-spawns idle shells per working directory so that
 * conversation starts can "claim" a warm shell instead of spawning cold.
 *
 * Pure main-process service: no SQLite, no IPC.
 * All DB reads/writes and IPC happen in callers (ptyIpc.ts / appIpc.ts).
 */
import { randomUUID } from 'node:crypto';
import { startPty, writePty, renamePty, killPty } from './ptyManager';
import { log } from '../../lib/logger';

interface PoolEntry {
  tempId: string;
}

class PtyPoolService {
  private pool = new Map<string, PoolEntry>(); // cwd → temp PTY entry

  /**
   * Pre-spawn an idle shell for the given cwd if one doesn't already exist.
   * Safe to call multiple times — no-op if a reserve already exists.
   */
  ensureReserve(cwd: string): void {
    if (this.pool.has(cwd)) return;
    const tempId = `pool-${randomUUID()}`;
    try {
      void startPty({ id: tempId, cwd });
      this.pool.set(cwd, { tempId });
      log.info('PtyPoolService: pre-spawned shell', { cwd, tempId });
    } catch (err) {
      log.warn('PtyPoolService: failed to pre-spawn shell', { cwd, error: String(err) });
    }
  }

  /**
   * Claim a pooled idle shell and inject the real command into it.
   *
   * @param cwd - The working directory to look up.
   * @param realId - The canonical PTY ID to assign (`{prov}-conv-{convId}`).
   * @param resolvedCommand - The full CLI command string to inject (e.g. `claude --session-id ...`).
   * @returns true on a pool hit; false on a miss (caller should call startPty directly).
   */
  claim(cwd: string, realId: string, resolvedCommand: string): boolean {
    const entry = this.pool.get(cwd);
    if (!entry) return false;
    this.pool.delete(cwd);
    try {
      renamePty(entry.tempId, realId);
      writePty(realId, `${resolvedCommand}\n`);
      log.info('PtyPoolService: claimed shell from pool', { cwd, realId });
      // Replenish the reserve in the background
      void this.replenish(cwd);
      return true;
    } catch (err) {
      log.warn('PtyPoolService: failed to claim shell from pool', {
        cwd,
        realId,
        error: String(err),
      });
      return false;
    }
  }

  /** Kill all pooled idle shells (called on app quit). */
  cleanup(): void {
    for (const [cwd, entry] of this.pool.entries()) {
      try {
        killPty(entry.tempId);
      } catch {}
      this.pool.delete(cwd);
    }
    log.info('PtyPoolService: cleaned up all pool entries');
  }

  private async replenish(cwd: string): Promise<void> {
    // Small delay before replenishing to avoid thrashing on rapid task creation
    await new Promise((resolve) => setTimeout(resolve, 500));
    this.ensureReserve(cwd);
  }
}

export const ptyPoolService = new PtyPoolService();
