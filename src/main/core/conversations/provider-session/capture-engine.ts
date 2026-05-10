import { promises as fs, watch as fsWatch } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import type { AgentProviderId } from '@shared/agent-provider-registry';
import { db } from '@main/db/client';
import { conversations } from '@main/db/schema';
import { log } from '@main/lib/logger';
import { getProviderSessionCapability } from './manifest';

/**
 * Generic post-spawn capture loop driven by ProviderSessionCapability.capture.
 *
 * Workflow per spawn:
 *   1. Snapshot existing entries under capability.capture.baseDir
 *   2. Watch the dir for new entries (file or directory creation)
 *   3. For each new entry passing matchesEntry + match (cwd correct), persist
 *      externalSessionId + externalSourcePath on the conversation row
 *   4. Time out after CAPTURE_TIMEOUT_MS
 *
 * TECH-DEBT: see docs/mcp-internal-spec.md §13a — this whole subsystem
 * disappears when CLIs accept --session-id at fresh launch (or when ACP
 * transport supersedes file-based transcripts).
 */

const CAPTURE_TIMEOUT_MS = 30_000;

export interface CaptureRequest {
  conversationId: string;
  providerId: AgentProviderId;
  cwd: string;
  signal?: AbortSignal;
}

export function captureExternalSession(req: CaptureRequest): void {
  const capability = getProviderSessionCapability(req.providerId);
  if (!capability?.capture) return;

  void run(capability.capture, req).catch((err) => {
    log.warn('provider-session: capture failed', {
      providerId: req.providerId,
      conversationId: req.conversationId,
      error: String(err),
    });
  });
}

async function run(
  config: NonNullable<ReturnType<typeof getProviderSessionCapability>>['capture'],
  req: CaptureRequest
): Promise<void> {
  if (!config) return;
  const baseDir = config.baseDir(homedir());
  await fs.mkdir(baseDir, { recursive: true });

  const seen = new Set<string>();
  await snapshot(baseDir, seen);

  let watcher: ReturnType<typeof fsWatch> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let settled = false;

  const cleanup = () => {
    if (settled) return;
    settled = true;
    watcher?.close();
    if (timer) clearTimeout(timer);
  };

  const onEvent = async (filename: string | null) => {
    if (settled || !filename) return;
    if (!config.matchesEntry(path.basename(filename))) return;
    const full = path.resolve(baseDir, filename);
    if (seen.has(full)) return;
    seen.add(full);

    let result;
    try {
      result = await config.match(full, req.cwd);
    } catch (err) {
      log.warn('provider-session: match threw', {
        providerId: req.providerId,
        path: full,
        error: String(err),
      });
      return;
    }
    if (!result) return;

    cleanup();
    await persist(req.conversationId, result.externalSessionId, result.externalSourcePath);
  };

  try {
    // macOS + Windows support recursive natively. Linux is best-effort
    // (top-level only) — see spec §13a tech debt.
    const recursive = config.recursive !== false && process.platform !== 'linux';
    watcher = fsWatch(baseDir, { recursive }, (_event, filename) => {
      void onEvent(filename);
    });
  } catch (err) {
    log.warn('provider-session: fs.watch failed; capture skipped', {
      providerId: req.providerId,
      error: String(err),
    });
    return;
  }

  req.signal?.addEventListener('abort', cleanup, { once: true });

  timer = setTimeout(() => {
    if (settled) return;
    cleanup();
    log.info('provider-session: capture timed out', {
      providerId: req.providerId,
      conversationId: req.conversationId,
    });
  }, CAPTURE_TIMEOUT_MS);
}

async function snapshot(dir: string, into: Set<string>): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    into.add(full);
    if (entry.isDirectory()) await snapshot(full, into);
  }
}

async function persist(
  conversationId: string,
  externalSessionId: string,
  externalSourcePath: string
): Promise<void> {
  await db
    .update(conversations)
    .set({ externalSessionId, externalSourcePath })
    .where(eq(conversations.id, conversationId));
  log.info('provider-session: captured', {
    conversationId,
    externalSessionId,
    externalSourcePath,
  });
}
