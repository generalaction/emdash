import { execFile } from 'node:child_process';

export interface PidPpidPair {
  pid: number;
  ppid: number;
}

export interface ProcessInfo extends PidPpidPair {
  pgid?: number;
  sessionId?: number;
  startTime?: string;
}

export interface ProcessTreeSnapshot {
  root?: ProcessInfo;
  descendants: ProcessInfo[];
}

const PS_TREE_COLUMNS = 'pid=,ppid=,pgid=,sess=,lstart=';

export function parseProcessTable(output: string): ProcessInfo[] {
  const processes: ProcessInfo[] = [];
  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length < 2) continue;
    const pid = Number(parts[0]);
    const ppid = Number(parts[1]);
    if (!Number.isInteger(pid) || !Number.isInteger(ppid)) continue;

    const pgid = Number(parts[2]);
    const sessionId = Number(parts[3]);
    const startTime = parts.slice(4).join(' ').trim();
    processes.push({
      pid,
      ppid,
      ...(Number.isInteger(pgid) ? { pgid } : {}),
      ...(Number.isInteger(sessionId) ? { sessionId } : {}),
      ...(startTime ? { startTime } : {}),
    });
  }
  return processes;
}

export function collectDescendantProcesses<T extends PidPpidPair>(
  processes: T[],
  roots: number[]
): T[] {
  const childrenByParent = new Map<number, T[]>();
  for (const processInfo of processes) {
    const existing = childrenByParent.get(processInfo.ppid);
    if (existing) existing.push(processInfo);
    else childrenByParent.set(processInfo.ppid, [processInfo]);
  }

  const seen = new Set<number>(roots);
  const descendants: T[] = [];
  const queue = [...roots];
  while (queue.length > 0) {
    const parent = queue.shift()!;
    const children = childrenByParent.get(parent);
    if (!children) continue;
    for (const child of children) {
      if (seen.has(child.pid)) continue;
      seen.add(child.pid);
      descendants.push(child);
      queue.push(child.pid);
    }
  }
  return descendants;
}

function snapshotLocalProcesses(args: string[]): Promise<ProcessInfo[]> {
  return new Promise((resolve) => {
    execFile(
      'ps',
      args,
      { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 2000 },
      (_error, stdout) => {
        resolve(parseProcessTable(stdout));
      }
    );
  });
}

export async function collectLocalProcessTreeAsync(rootPid: number): Promise<ProcessTreeSnapshot> {
  const processes = await snapshotLocalProcesses(['-A', '-o', PS_TREE_COLUMNS]);
  return {
    root: processes.find(({ pid }) => pid === rootPid),
    descendants: collectDescendantProcesses(processes, [rootPid]),
  };
}

export async function collectLocalProcessInfosByPidAsync(
  pids: number[]
): Promise<Map<number, ProcessInfo>> {
  const uniquePids = [...new Set(pids.filter((pid) => Number.isInteger(pid) && pid > 0))];
  if (uniquePids.length === 0) return new Map();

  const processes = await snapshotLocalProcesses([
    '-p',
    uniquePids.join(','),
    '-o',
    PS_TREE_COLUMNS,
  ]);
  return new Map(processes.map((processInfo) => [processInfo.pid, processInfo]));
}
