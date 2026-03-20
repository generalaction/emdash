import { describe, it, expect, beforeEach } from 'vitest';
import {
  getProvisionLogs,
  appendProvisionLog,
  clearProvisionLogs,
  _resetCache,
} from '../../renderer/lib/provisionLogCache';

describe('provisionLogCache', () => {
  beforeEach(() => {
    _resetCache();
  });

  it('returns empty array for unknown task', () => {
    expect(getProvisionLogs('task-1')).toEqual([]);
  });

  it('appends log lines and returns accumulated result', () => {
    const after1 = appendProvisionLog('task-1', 'line-1');
    expect(after1).toEqual(['line-1']);

    const after2 = appendProvisionLog('task-1', 'line-2');
    expect(after2).toEqual(['line-1', 'line-2']);
  });

  it('persists logs across getProvisionLogs calls (simulates unmount/remount)', () => {
    appendProvisionLog('task-1', 'line-a');
    appendProvisionLog('task-1', 'line-b');

    // Simulate component remount — reading from cache
    const restored = getProvisionLogs('task-1');
    expect(restored).toEqual(['line-a', 'line-b']);
  });

  it('isolates logs between different task IDs', () => {
    appendProvisionLog('task-1', 'task1-line');
    appendProvisionLog('task-2', 'task2-line');

    expect(getProvisionLogs('task-1')).toEqual(['task1-line']);
    expect(getProvisionLogs('task-2')).toEqual(['task2-line']);
  });

  it('clearProvisionLogs removes logs for the given task', () => {
    appendProvisionLog('task-1', 'line-1');
    appendProvisionLog('task-1', 'line-2');

    clearProvisionLogs('task-1');
    expect(getProvisionLogs('task-1')).toEqual([]);
  });

  it('clearProvisionLogs does not affect other tasks', () => {
    appendProvisionLog('task-1', 'line-a');
    appendProvisionLog('task-2', 'line-b');

    clearProvisionLogs('task-1');
    expect(getProvisionLogs('task-2')).toEqual(['line-b']);
  });

  it('can append after clearing (simulates retry)', () => {
    appendProvisionLog('task-1', 'attempt-1');
    clearProvisionLogs('task-1');

    const result = appendProvisionLog('task-1', 'attempt-2');
    expect(result).toEqual(['attempt-2']);
    expect(getProvisionLogs('task-1')).toEqual(['attempt-2']);
  });
});
