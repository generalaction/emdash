import { describe, expect, it } from 'vitest';
import type { ExecFn } from '@main/core/utils/exec';
import { extractGhCliToken, isGhCliAuthenticated } from './gh-cli-token';

function makeExec(responses: Record<string, { stdout: string; stderr: string }>): ExecFn {
  return async (command: string, args?: string[]) => {
    const key = [command, ...(args || [])].join(' ');
    const response = responses[key];
    if (!response) throw new Error(`Command not found: ${key}`);
    return response;
  };
}

describe('isGhCliAuthenticated', () => {
  it('returns true when gh auth status succeeds', async () => {
    const exec = makeExec({ 'gh auth status': { stdout: '', stderr: '' } });
    expect(await isGhCliAuthenticated(exec)).toBe(true);
  });

  it('returns false when gh auth status fails', async () => {
    const exec: ExecFn = async () => {
      throw new Error('not authenticated');
    };
    expect(await isGhCliAuthenticated(exec)).toBe(false);
  });
});

describe('extractGhCliToken', () => {
  it('returns trimmed token from gh auth token', async () => {
    const exec = makeExec({ 'gh auth token': { stdout: 'gho_abc123\n', stderr: '' } });
    expect(await extractGhCliToken(exec)).toBe('gho_abc123');
  });

  it('returns null when gh auth token fails', async () => {
    const exec: ExecFn = async () => {
      throw new Error('no token');
    };
    expect(await extractGhCliToken(exec)).toBeNull();
  });

  it('returns null for empty stdout', async () => {
    const exec = makeExec({ 'gh auth token': { stdout: '', stderr: '' } });
    expect(await extractGhCliToken(exec)).toBeNull();
  });
});
