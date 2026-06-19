import { execFile } from 'node:child_process';
import { log } from '@main/lib/logger';

export interface PidPpidPair {
  pid: number;
  ppid: number;
}

/**
 * Parse the output of `ps -o pid=,ppid=` into (pid, ppid) pairs.
 * Lines that do not start with two integers are skipped, so the parser is
 * tolerant of a stray header row or platform formatting quirks.
 */
export function parsePidPpidPairs(output: string): PidPpidPair[] {
  const pairs: PidPpidPair[] = [];
  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length < 2) continue;
    const pid = Number(parts[0]);
    const ppid = Number(parts[1]);
    if (!Number.isInteger(pid) || !Number.isInteger(ppid)) continue;
    pairs.push({ pid, ppid });
  }
  return pairs;
}

/**
 * Given a process-table snapshot and a set of root pids, return every
 * transitive descendant pid (excluding the roots themselves). Cycle-safe.
 */
export function collectDescendantPids(pairs: PidPpidPair[], roots: number[]): number[] {
  const childrenByParent = new Map<number, number[]>();
  for (const { pid, ppid } of pairs) {
    const existing = childrenByParent.get(ppid);
    if (existing) existing.push(pid);
    else childrenByParent.set(ppid, [pid]);
  }

  const seen = new Set<number>(roots);
  const descendants: number[] = [];
  const queue = [...roots];
  while (queue.length > 0) {
    const parent = queue.shift()!;
    const children = childrenByParent.get(parent);
    if (!children) continue;
    for (const child of children) {
      if (seen.has(child)) continue;
      seen.add(child);
      descendants.push(child);
      queue.push(child);
    }
  }
  return descendants;
}

/**
 * Snapshot the local process table and resolve the transitive descendant pids
 * of `rootPid`. Best-effort: resolves `[]` if `ps` is unavailable or fails.
 *
 * Asynchronous on purpose — this runs on the Electron main process, so spawning
 * `ps` must not block the event loop. POSIX only; callers guard the platform.
 * `ps -A -o pid=,ppid=` is supported by both Linux (procps) and macOS (BSD) `ps`.
 */
export function collectLocalDescendantPidsAsync(rootPid: number): Promise<number[]> {
  return new Promise((resolve) => {
    execFile(
      'ps',
      ['-A', '-o', 'pid=,ppid='],
      { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 2000 },
      (error, stdout) => {
        if (error) {
          log.debug('collectLocalDescendantPidsAsync: ps snapshot failed', {
            error: String(error),
          });
          resolve([]);
          return;
        }
        resolve(collectDescendantPids(parsePidPpidPairs(stdout), [rootPid]));
      }
    );
  });
}
