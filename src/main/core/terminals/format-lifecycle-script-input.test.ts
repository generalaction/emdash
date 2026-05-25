import { describe, expect, it } from 'vitest';
import { formatLifecycleScriptInput } from './format-lifecycle-script-input';

describe('formatLifecycleScriptInput', () => {
  const copyLine =
    'copy "%USERPROFILE%\\Documents\\Github\\some-repo\\some-folder\\some-folder.env" "some-folder\\some-folder.env"';
  const npmLine = 'npm --prefix some-folder/some-folder install';

  it('joins newline-separated Windows setup commands with &', () => {
    const script = `${copyLine}\n${npmLine}`;

    expect(formatLifecycleScriptInput(script, { platform: 'win32' })).toBe(
      `${copyLine} & ${npmLine}`
    );
  });

  it('appends exit with & on Windows', () => {
    expect(formatLifecycleScriptInput('pnpm install', { platform: 'win32', exit: true })).toBe(
      'pnpm install & exit'
    );
  });

  it('joins multiline Windows scripts before exit', () => {
    const script = `${copyLine}\r\n${npmLine}`;

    expect(formatLifecycleScriptInput(script, { platform: 'win32', exit: true })).toBe(
      `${copyLine} & ${npmLine} & exit`
    );
  });

  it('preserves POSIX newline-separated commands', () => {
    const script = 'pnpm install\npnpm build';

    expect(formatLifecycleScriptInput(script, { platform: 'darwin' })).toBe(script);
  });

  it('uses explicit shell kind instead of host platform', () => {
    const script = 'pnpm install\npnpm build';

    expect(formatLifecycleScriptInput(script, { platform: 'win32', shellKind: 'posix' })).toBe(
      script
    );
  });

  it('appends ; exit on POSIX', () => {
    expect(formatLifecycleScriptInput('pnpm dev', { platform: 'linux', exit: true })).toBe(
      'pnpm dev; exit'
    );
  });

  it('preserves POSIX multiline scripts before exit', () => {
    const script = 'pnpm install\npnpm build';

    expect(formatLifecycleScriptInput(script, { platform: 'linux', exit: true })).toBe(
      `${script}; exit`
    );
  });

  it('ignores blank lines', () => {
    const script = 'pnpm install\n\npnpm build';

    expect(formatLifecycleScriptInput(script, { platform: 'win32' })).toBe(
      'pnpm install & pnpm build'
    );
    expect(formatLifecycleScriptInput(script, { platform: 'darwin' })).toBe(
      'pnpm install\npnpm build'
    );
  });
});
