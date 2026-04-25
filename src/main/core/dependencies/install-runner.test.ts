import { describe, expect, it } from 'vitest';
import { classifyInstallCommandFailure } from './install-runner';

describe('classifyInstallCommandFailure', () => {
  it('summarizes permission errors from npm global installs', () => {
    expect(
      classifyInstallCommandFailure({
        exitCode: 243,
        output:
          '\u001b[1mnpm\u001b[22m \u001b[31merror\u001b[39m code EACCES\nnpm error path /usr/lib/node_modules/@openai\npermission denied',
      })
    ).toEqual({
      type: 'permission-denied',
      exitCode: 243,
      output:
        'npm error code EACCES\nnpm error path /usr/lib/node_modules/@openai\npermission denied',
      message: 'User does not have sufficient permissions.',
    });
  });

  it('returns command-failed for non-permission failures', () => {
    expect(
      classifyInstallCommandFailure({
        exitCode: 1,
        output: 'network unavailable',
      })
    ).toEqual({
      type: 'command-failed',
      exitCode: 1,
      output: 'network unavailable',
      message: 'Install command failed.',
    });
  });
});
