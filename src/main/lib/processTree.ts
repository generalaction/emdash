/**
 * Lightweight process-tree snapshot.
 *
 * Uses a single `ps` call on macOS/Linux to capture PID, parent PID,
 * %CPU and RSS atomically — no race between "discover children" and
 * "read metrics".
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const EXEC_TIMEOUT_MS = 5_000;
const MAX_BUFFER = 10 * 1024 * 1024;

export interface ProcessInfo {
  pid: number;
  ppid: number;
  /** CPU usage as a percentage (can exceed 100 on multi-core). */
  cpu: number;
  /** Resident memory in bytes. */
  memory: number;
}

export interface ProcessSnapshot {
  byPid: Map<number, ProcessInfo>;
  childrenOf: Map<number, number[]>;
}

export interface SubtreeResources {
  cpu: number;
  memory: number;
  pids: number[];
}

/**
 * Capture an atomic snapshot of all running processes.
 * Uses `ps` on macOS/Linux. On Windows, logs a warning and returns an
 * empty snapshot (Windows process enumeration is not yet implemented).
 */
export async function captureProcessSnapshot(): Promise<ProcessSnapshot> {
  const raw = await listProcesses();
  const byPid = new Map<number, ProcessInfo>();
  const childrenOf = new Map<number, number[]>();

  for (const p of raw) {
    byPid.set(p.pid, p);
    let children = childrenOf.get(p.ppid);
    if (!children) {
      children = [];
      childrenOf.set(p.ppid, children);
    }
    children.push(p.pid);
  }

  return { byPid, childrenOf };
}

let warnedWindowsOnce = false;
let warnedUnixOnce = false;

async function listProcesses(): Promise<ProcessInfo[]> {
  if (process.platform === 'win32') {
    if (!warnedWindowsOnce) {
      console.warn(
        '[perf] Process tree metrics are not yet supported on Windows — PTY sessions will show 0 CPU / 0 memory.'
      );
      warnedWindowsOnce = true;
    }
    return [];
  }
  return listProcessesUnix();
}

/**
 * Return every PID that is a descendant of `rootPid` (including
 * `rootPid` itself), provided the PID exists in the snapshot.
 */
export function getSubtreePids(snapshot: ProcessSnapshot, rootPid: number): number[] {
  const pids: number[] = [];
  const stack = [rootPid];
  const visited = new Set<number>();

  while (stack.length > 0) {
    const pid = stack.pop();
    if (pid === undefined || visited.has(pid)) continue;
    visited.add(pid);

    if (snapshot.byPid.has(pid)) {
      pids.push(pid);
    }
    const children = snapshot.childrenOf.get(pid);
    if (children) {
      for (const child of children) {
        stack.push(child);
      }
    }
  }

  return pids;
}

/**
 * Sum CPU and memory for the entire process subtree rooted at `rootPid`.
 */
export function getSubtreeResources(snapshot: ProcessSnapshot, rootPid: number): SubtreeResources {
  const pids = getSubtreePids(snapshot, rootPid);
  let cpu = 0;
  let memory = 0;

  for (const pid of pids) {
    const info = snapshot.byPid.get(pid);
    if (info) {
      cpu += info.cpu;
      memory += info.memory;
    }
  }

  return { cpu, memory, pids };
}

// ── Platform-specific process listing ─────────────────────────────────

async function listProcessesUnix(): Promise<ProcessInfo[]> {
  try {
    const { stdout } = await execFileAsync('ps', ['-eo', 'pid=,ppid=,pcpu=,rss='], {
      maxBuffer: MAX_BUFFER,
      timeout: EXEC_TIMEOUT_MS,
    });

    const result: ProcessInfo[] = [];
    for (const line of stdout.split('\n')) {
      const t = line.trim();
      if (!t) continue;

      const parts = t.split(/\s+/);
      if (parts.length < 4) continue;

      const pid = parseInt(parts[0], 10);
      const ppid = parseInt(parts[1], 10);
      if (isNaN(pid) || isNaN(ppid)) continue;

      const cpu = parseFloat(parts[2]);
      const rssKb = parseInt(parts[3], 10);

      result.push({
        pid,
        ppid,
        cpu: isFinite(cpu) ? Math.max(0, cpu) : 0,
        memory: isFinite(rssKb) ? Math.max(0, rssKb) * 1024 : 0,
      });
    }

    return result;
  } catch (err) {
    if (!warnedUnixOnce) {
      warnedUnixOnce = true;
      console.warn('[perf] Failed to list processes via ps:', err);
    }
    return [];
  }
}
