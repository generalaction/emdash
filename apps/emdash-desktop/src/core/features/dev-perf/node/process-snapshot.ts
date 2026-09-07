import { execFile } from 'node:child_process';
import { recordSpawn } from '@emdash/shared/perf';
import type { DevPerfProcess } from '../api/contract';

export type PsProcess = {
  pid: number;
  ppid: number;
  cpuPercent: number;
  rssBytes: number;
  command: string;
};

/**
 * Parse `ps -A -o pid=,ppid=,pcpu=,rss=,comm=` output. The command column is
 * last and may contain spaces; `rss` is reported in KiB on both macOS (BSD ps)
 * and Linux (procps).
 */
export function parsePsSnapshot(output: string): PsProcess[] {
  const processes: PsProcess[] = [];
  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length < 5) continue;
    const pid = Number(parts[0]);
    const ppid = Number(parts[1]);
    const cpuPercent = Number(parts[2]);
    const rssKb = Number(parts[3]);
    if (!Number.isInteger(pid) || !Number.isInteger(ppid)) continue;
    if (!Number.isFinite(cpuPercent) || !Number.isFinite(rssKb)) continue;
    processes.push({
      pid,
      ppid,
      cpuPercent,
      rssBytes: rssKb * 1024,
      command: parts.slice(4).join(' '),
    });
  }
  return processes;
}

/**
 * Flatten the process tree rooted at `rootPid` into depth-first order with a
 * per-row depth for indentation. Cycle-safe; processes outside the app's tree
 * are excluded. Children are ordered by pid for a stable panel layout.
 */
export function flattenProcessTree(processes: PsProcess[], rootPid: number): DevPerfProcess[] {
  const byPid = new Map(processes.map((processInfo) => [processInfo.pid, processInfo]));
  const childrenByParent = new Map<number, PsProcess[]>();
  for (const processInfo of processes) {
    const siblings = childrenByParent.get(processInfo.ppid);
    if (siblings) siblings.push(processInfo);
    else childrenByParent.set(processInfo.ppid, [processInfo]);
  }

  const rows: DevPerfProcess[] = [];
  const seen = new Set<number>();
  const visit = (pid: number, depth: number): void => {
    if (seen.has(pid)) return;
    seen.add(pid);
    const processInfo = byPid.get(pid);
    if (processInfo) rows.push({ ...processInfo, depth });
    const children = childrenByParent.get(pid) ?? [];
    for (const child of [...children].sort((a, b) => a.pid - b.pid)) {
      visit(child.pid, depth + 1);
    }
  };
  visit(rootPid, 0);
  return rows;
}

export const PROCESS_SNAPSHOT_SUPPORTED = process.platform !== 'win32';

/**
 * Snapshot the app's live process tree via one `ps` invocation. Best-effort:
 * resolves an empty list when `ps` fails or the platform has no `ps`.
 */
export async function snapshotProcessTree(
  rootPid: number = process.pid
): Promise<DevPerfProcess[]> {
  if (!PROCESS_SNAPSHOT_SUPPORTED) return [];
  const output = await new Promise<string>((resolve) => {
    recordSpawn('other', 'ps');
    execFile(
      'ps',
      ['-A', '-o', 'pid=,ppid=,pcpu=,rss=,comm='],
      { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 2_000 },
      (_error, stdout) => resolve(stdout ?? '')
    );
  });
  return flattenProcessTree(parsePsSnapshot(output), rootPid);
}
