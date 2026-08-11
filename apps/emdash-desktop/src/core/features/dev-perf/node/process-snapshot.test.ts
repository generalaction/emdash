import { describe, expect, it } from 'vitest';
import { flattenProcessTree, parsePsSnapshot } from './process-snapshot';

const PS_OUTPUT = [
  '    1     0   0.0  1200 /sbin/launchd',
  '  100     1   3.5 512000 /Applications/emdash.app/Contents/MacOS/emdash',
  '  101   100  12.0 384000 emdash Helper (Renderer)',
  '  102   100   0.4  90000 emdash Helper (GPU)',
  '  110   100   1.1  80000 node worker git',
  '  200   110  25.0  16000 git status --porcelain',
  '  201   110   0.0  12000 git fetch origin',
  '  300     1   0.0  4000 unrelated-daemon',
].join('\n');

describe('parsePsSnapshot', () => {
  it('parses pid, ppid, cpu, rss (KiB -> bytes) and space-containing commands', () => {
    const processes = parsePsSnapshot(PS_OUTPUT);
    expect(processes).toHaveLength(8);
    const renderer = processes.find(({ pid }) => pid === 101)!;
    expect(renderer).toEqual({
      pid: 101,
      ppid: 100,
      cpuPercent: 12,
      rssBytes: 384000 * 1024,
      command: 'emdash Helper (Renderer)',
    });
  });

  it('skips malformed lines', () => {
    expect(parsePsSnapshot('garbage\n  abc def 1 2 cmd\n\n')).toEqual([]);
  });
});

describe('flattenProcessTree', () => {
  it('returns the app tree in depth-first order including spawned grandchildren', () => {
    const rows = flattenProcessTree(parsePsSnapshot(PS_OUTPUT), 100);
    expect(rows.map(({ pid, depth }) => [pid, depth])).toEqual([
      [100, 0],
      [101, 1],
      [102, 1],
      [110, 1],
      [200, 2],
      [201, 2],
    ]);
    // Processes outside the app tree are excluded.
    expect(rows.some(({ pid }) => pid === 1 || pid === 300)).toBe(false);
  });

  it('is cycle-safe and tolerates a missing root', () => {
    const processes = parsePsSnapshot(PS_OUTPUT);
    expect(flattenProcessTree(processes, 99999)).toEqual([]);

    const cyclic = [
      { pid: 5, ppid: 6, cpuPercent: 0, rssBytes: 0, command: 'a' },
      { pid: 6, ppid: 5, cpuPercent: 0, rssBytes: 0, command: 'b' },
    ];
    const rows = flattenProcessTree(cyclic, 5);
    expect(rows.map(({ pid }) => pid)).toEqual([5, 6]);
  });
});
